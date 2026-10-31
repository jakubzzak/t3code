import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { InboxError, ProjectId, type InboxSource } from "@t3tools/contracts";
import { ingestInboxItem } from "./inboxState.ts";
import * as Sources from "./InboxSources.ts";
import * as Inbox from "./InboxService.ts";
import * as Linear from "../linear/LinearConnection.ts";
import * as Slack from "./SlackConnection.ts";
import * as Superhuman from "./SuperhumanConnection.ts";
import * as Transport from "./InboxSourceTransport.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Settings from "../serverSettings.ts";
import * as Sqlite from "../persistence/Sqlite.ts";

it.effect(
  "shares bounded session reads, follows the notification target, expires failures and recovers",
  () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("agent-test");
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let status = "active";
      let failing = false;
      let parentId: string | null = "root";
      let source: InboxSource = "linear";
      const reads: string[] = [];
      const layer = Sources.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Sqlite.layerMemory,
            Settings.layerTest(),
            Layer.mock(Inbox.InboxService)({
              get: () =>
                Effect.sync(() =>
                  ingestInboxItem(projectId, {
                    id: "item",
                    source,
                    connectionId: "workspace:me",
                    groupId: "issue",
                    location: "DEMO-1",
                    title: "Discussion",
                    author: "Alex",
                    content: "Review",
                    url: "https://linear.app/example/issue/DEMO-1",
                    occurredAt: "2026-10-31T10:00:00Z",
                    replyTarget: { source: "linear", issueId: "issue", parentId },
                  }),
                ),
            }),
            Layer.mock(Linear.LinearConnection)({
              readAgentThread: (_projectId, commentId) =>
                Effect.gen(function* () {
                  reads.push(commentId);
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(release);
                  if (failing) return yield* new InboxError({ detail: "Synthetic source failure" });
                  return {
                    commentId,
                    rootCommentId: commentId,
                    agentId: "agent",
                    agentName: "Tars",
                    sessionId: "session",
                    status,
                  };
                }),
            }),
            Layer.mock(Slack.SlackConnection)({}),
            Layer.mock(Superhuman.SuperhumanConnection)({}),
            Layer.mock(Transport.InboxSourceTransport)({}),
            Layer.mock(Secrets.ServerSecretStore)({}),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const service = yield* Sources.InboxSources;
        const input = { projectId, id: "notification" };
        const pending = yield* Effect.all(
          [service.linearAgentThread(input), service.linearAgentThread(input)],
          { concurrency: "unbounded" },
        ).pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        assert.deepEqual(reads, ["root"]);
        yield* Deferred.succeed(release, undefined);
        const results = yield* Fiber.join(pending);
        assert.equal(results[0]?.status, "active");
        assert.equal(results[1]?.status, "active");
        status = "complete";
        yield* TestClock.adjust("5 seconds");
        assert.equal((yield* service.linearAgentThread(input))?.status, "complete");
        assert.deepEqual(reads, ["root", "root"]);
        failing = true;
        yield* TestClock.adjust("5 seconds");
        assert.equal((yield* Effect.result(service.linearAgentThread(input)))._tag, "Failure");
        failing = false;
        status = "active";
        yield* TestClock.adjust("5 seconds");
        assert.equal((yield* service.linearAgentThread(input))?.status, "active");
        parentId = "another-thread";
        assert.equal((yield* service.linearAgentThread(input))?.rootCommentId, "another-thread");
        const count = reads.length;
        parentId = null;
        assert.equal(yield* service.linearAgentThread(input), null);
        source = "slack";
        assert.equal(yield* service.linearAgentThread(input), null);
        assert.equal(reads.length, count);
      }).pipe(Effect.provide(layer));
    }),
);
