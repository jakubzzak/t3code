import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { InboxNotification } from "@t3tools/contracts";
import * as Slack from "./SlackConnection.ts";
import * as Transport from "./InboxSourceTransport.ts";

export class InboxAttachments extends Context.Service<
  InboxAttachments,
  {
    readonly load: (notification: InboxNotification) => Effect.Effect<{
      images: ReadonlyArray<{ data: string; mimeType: string }>;
      context: ReadonlyArray<{
        id: string;
        name: string;
        messageTs: string;
        status: "attached" | "unavailable" | "omitted";
        imageIndex?: number;
      }>;
    }>;
  }
>()("t3/inbox/InboxAttachments") {}

const make = Effect.gen(function* () {
  const slack = yield* Slack.SlackConnection;
  const transport = yield* Transport.InboxSourceTransport;
  return InboxAttachments.of({
    load: Effect.fn("InboxAttachments.load")(function* (notification) {
      const images: Array<{ data: string; mimeType: string }> = [];
      const context: Array<{
        id: string;
        name: string;
        messageTs: string;
        status: "attached" | "unavailable" | "omitted";
        imageIndex?: number;
      }> = [];
      const thread = notification.source === "slack" ? notification.slackThread : undefined;
      if (!thread) return { images, context };
      // Match the bounded text context, prioritizing the triggering message over older images.
      const candidates = [thread.root, ...thread.messages.slice(-10)]
        .toReversed()
        .flatMap((message) => (message.images ?? []).map((image) => ({ image, ts: message.ts })));
      if (!candidates.length) return { images, context };
      const seen = new Set<string>();
      const unique = candidates.filter(({ image }) => {
        if (seen.has(image.id)) return false;
        seen.add(image.id);
        return true;
      });
      const token = yield* slack.accessToken(notification.projectId).pipe(Effect.result);
      // Bound latency as well as bytes so image loading leaves time for summary generation.
      const loaded = yield* Effect.forEach(
        unique.slice(0, 4),
        ({ image }) =>
          image.url && token._tag === "Success"
            ? transport
                .readImage(token.success, image.url, notification.connectionId)
                .pipe(Effect.timeout("20 seconds"), Effect.result)
            : Effect.succeed(null),
        { concurrency: 4 },
      );
      let size = 0;
      for (const [index, { image, ts }] of unique.entries()) {
        const entry = { id: image.id, name: image.name, messageTs: ts };
        if (index >= 4) {
          context.push({ ...entry, status: "omitted" });
          continue;
        }
        const result = loaded[index];
        if (!result || result._tag === "Failure") {
          context.push({ ...entry, status: "unavailable" });
          continue;
        }
        const { bytes, mimeType } = result.success;
        // Keep each base64 image below provider limits, including Claude through Bedrock.
        if (bytes.length > 3 * 1024 * 1024 || size + bytes.length > 10 * 1024 * 1024) {
          context.push({ ...entry, status: "omitted" });
          continue;
        }
        size += bytes.length;
        images.push({ data: Buffer.from(bytes).toString("base64"), mimeType });
        context.push({ ...entry, status: "attached", imageIndex: images.length });
      }
      return { images, context };
    }),
  });
});
export const layer = Layer.effect(InboxAttachments, make);
