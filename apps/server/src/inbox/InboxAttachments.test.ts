import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { InboxError, ProjectId, type InboxSlackImage } from "@t3tools/contracts";
import * as Attachments from "./InboxAttachments.ts";
import * as Slack from "./SlackConnection.ts";
import * as Transport from "./InboxSourceTransport.ts";
import { ingestInboxItem } from "./inboxState.ts";

const projectId = ProjectId.make("images");
const image = (id: string) => ({ id, name: `${id}.png`, url: `https://files.slack.com/${id}.png` });
const notification = (images: ReadonlyArray<InboxSlackImage>) => {
  const message = {
    ts: "10.1",
    author: "Alex",
    content: "Can we mark those done?",
    formattedContent: "Can we mark those done?",
    occurredAt: "2026-11-06T10:00:00Z",
    images,
  };
  return {
    ...ingestInboxItem(projectId, {
      id: "D1:10.1",
      source: "slack",
      connectionId: "T1:U1",
      groupId: "D1:10.1",
      title: "DM",
      author: "Alex",
      content: message.content,
      location: "DM",
      url: "https://slack.com",
      occurredAt: message.occurredAt,
    }),
    slackThread: {
      channelId: "D1",
      ts: message.ts,
      root: message,
      messages: [message],
      latestReplyTs: message.ts,
      replyCount: 0,
      nextCursor: null,
    },
  };
};
const fixture = (
  readImage: Transport.InboxSourceTransport["Service"]["readImage"],
  unauthorized = false,
) =>
  Attachments.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Slack.SlackConnection)({
          accessToken: (id) => {
            assert.equal(id, projectId);
            return unauthorized
              ? Effect.fail(new InboxError({ detail: "Disconnected" }))
              : Effect.succeed("fixture-token");
          },
        }),
        Layer.mock(Transport.InboxSourceTransport)({ readImage }),
      ),
    ),
  );

it.effect("downloads each source image once using the notification's account", () => {
  const reads: string[] = [];
  return Effect.gen(function* () {
    const media = yield* (yield* Attachments.InboxAttachments).load(notification([image("F1")]));
    assert.deepEqual(reads, ["https://files.slack.com/F1.png"]);
    assert.deepEqual(media.images, [{ data: "AQID", mimeType: "image/png" }]);
    assert.deepEqual(media.context, [
      { id: "F1", name: "F1.png", messageTs: "10.1", status: "attached", imageIndex: 1 },
    ]);
  }).pipe(
    Effect.provide(
      fixture((token, url, account) => {
        assert.equal(token, "fixture-token");
        assert.equal(account, "T1:U1");
        reads.push(url);
        return Effect.succeed({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" });
      }),
    ),
  );
});

it.effect.each(["download", "token", "missing-url"] as const)(
  "reports unreadable images without inventing content: %s",
  (reason) => {
    let reads = 0;
    return Effect.gen(function* () {
      const media = yield* (yield* Attachments.InboxAttachments).load(
        notification([reason === "missing-url" ? { id: "F1", name: "F1.png" } : image("F1")]),
      );
      assert.deepEqual(media.images, []);
      assert.equal(media.context[0]?.status, "unavailable");
      assert.equal(reads, reason === "download" ? 1 : 0);
    }).pipe(
      Effect.provide(
        fixture(() => {
          reads++;
          return Effect.fail(new InboxError({ detail: "Unavailable" }));
        }, reason === "token"),
      ),
    );
  },
);

it.effect("bounds reads and aggregate model bytes, prioritizing the newest message", () => {
  let reads = 0;
  return Effect.gen(function* () {
    const source = notification([image("old")]);
    const latest = {
      ...source.slackThread.root,
      ts: "11.1",
      images: Array.from({ length: 5 }, (_, i) => image(`new${i}`)),
    };
    const media = yield* (yield* Attachments.InboxAttachments).load({
      ...source,
      slackThread: { ...source.slackThread, messages: [source.slackThread.root, latest] },
    });
    assert.equal(reads, 4);
    assert.equal(media.images.length, 3);
    assert.equal(media.context[0]?.id, "new0");
    assert.equal(media.context[0]?.status, "attached");
    assert.ok(media.context.slice(3).every((item) => item.status === "omitted"));
  }).pipe(
    Effect.provide(
      fixture(() => {
        reads++;
        return Effect.succeed({ bytes: new Uint8Array(3 * 1024 * 1024), mimeType: "image/png" });
      }),
    ),
  );
});

it.effect("finishes stalled image reads within the summary budget", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const layer = fixture(() =>
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    );
    const fiber = yield* Effect.gen(function* () {
      return yield* (yield* Attachments.InboxAttachments).load(
        notification([image("F1"), image("F2")]),
      );
    }).pipe(Effect.provide(layer), Effect.forkChild);
    yield* Deferred.await(started);
    yield* TestClock.adjust("20 seconds");
    const media = yield* Fiber.join(fiber);
    assert.deepEqual(media.images, []);
    assert.deepEqual(
      media.context.map((item) => item.status),
      ["unavailable", "unavailable"],
    );
  }),
);

it.effect("does not authenticate or download for notifications without source images", () =>
  Effect.gen(function* () {
    const media = yield* (yield* Attachments.InboxAttachments).load(notification([]));
    assert.deepEqual(media, { images: [], context: [] });
  }).pipe(
    Effect.provide(
      Attachments.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(Slack.SlackConnection)({}),
            Layer.mock(Transport.InboxSourceTransport)({}),
          ),
        ),
      ),
    ),
  ),
);

it.effect("omits images that exceed the per-image provider limit", () =>
  Effect.gen(function* () {
    const media = yield* (yield* Attachments.InboxAttachments).load(notification([image("large")]));
    assert.deepEqual(media.images, []);
    assert.equal(media.context[0]?.status, "omitted");
  }).pipe(
    Effect.provide(
      fixture(() =>
        Effect.succeed({ bytes: new Uint8Array(3 * 1024 * 1024 + 1), mimeType: "image/png" }),
      ),
    ),
  ),
);
