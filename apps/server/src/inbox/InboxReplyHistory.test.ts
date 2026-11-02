import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as HttpClient from "effect/http/HttpClient";
import {
  CommandId,
  ProjectId,
  ThreadId,
  InboxReplyError,
  type InboxLinearComment,
} from "@t3tools/contracts";
import * as Inbox from "./InboxService.ts";
import * as Sources from "./InboxSources.ts";
import * as Repository from "./InboxRepository.ts";
import * as Reply from "./InboxReplyTransport.ts";
import * as SourceTransport from "./InboxSourceTransport.ts";
import * as Linear from "../linear/LinearConnection.ts";
import * as Slack from "./SlackConnection.ts";
import * as Superhuman from "./SuperhumanConnection.ts";
import * as Settings from "../serverSettings.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Config from "../config.ts";
import * as Analysis from "./InboxAnalysis.ts";
import * as Agent from "./InboxAgent.ts";
import * as Research from "./InboxResearch.ts";

it.effect.each([true, false])(
  "accepted reply and full history stay consistent with own replies shown=%s",
  (showOwn) =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("reply-history");
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let reject = true;
      let posts = 0;
      const comments: InboxLinearComment[] = [0, 1, 2].map((index) => ({
        id: `old-${index}`,
        author: "Tars",
        body: `Earlier reply ${index}`,
        occurredAt: `2026-10-22T10:0${index}:00Z`,
      }));
      const issue = () => ({
        id: "issue",
        title: "Agent discussion",
        description: null,
        comments: [...comments],
        commentCount: comments.length,
        commentsComplete: true,
        commentMetadataVersion: 1 as const,
        agentMetadataVersion: 1 as const,
      });
      const linear = Layer.succeed(Linear.LinearConnection, {
        createComment: (_project, _connection, input) =>
          Effect.gen(function* () {
            if (reject) return yield* new InboxReplyError({ reason: "rejected" });
            posts++;
            const message = {
              id: "accepted",
              author: "Jakub",
              text: input.body,
              occurredAt: "2026-10-22T10:03:00Z",
            };
            comments.push({
              id: message.id,
              author: message.author,
              body: message.text,
              occurredAt: message.occurredAt,
            });
            return message;
          }),
        readIssue: () =>
          Effect.gen(function* () {
            const snapshot = issue();
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
            return snapshot;
          }),
        request: () =>
          Effect.succeed({
            configured: true,
            connection: {
              workspace: "fixture",
              userId: "me",
              name: "Jakub",
              email: "fixture@example.test",
            },
          }),
        read: () => Effect.succeed([]),
        readAgentThread: () => Effect.succeed(null),
        begin: () => Effect.die("Unused OAuth"),
        complete: () => Effect.void,
        cancel: () => Effect.void,
        disconnect: () => Effect.void,
        prepareMigration: () => Effect.die("Unused migration"),
        importMigration: () => Effect.void,
      });
      const base = Layer.mergeAll(
        Sqlite.layerMemory,
        Settings.layerTest({
          inboxShowSelfReplies: showOwn,
          projectSettingsOverrides: {
            [projectId]: { inboxEnabled: true, inboxSummaryEnabled: false },
          },
        }),
        linear,
        Layer.succeed(Slack.SlackConnection, {
          begin: () => Effect.die("Unused Slack"),
          complete: () => Effect.die("Unused Slack"),
          cancel: () => Effect.void,
          disconnect: () => Effect.void,
          status: () => Effect.succeed({}),
          accessToken: () => Effect.die("Unused Slack"),
        }),
        Layer.succeed(Superhuman.SuperhumanConnection, {
          begin: () => Effect.die("Unused email"),
          complete: () => Effect.die("Unused email"),
          disconnect: () => Effect.void,
          read: () => Effect.succeed([]),
          catalog: () => Effect.succeed({ accounts: [], splits: [], labels: [] }),
        }),
        Layer.succeed(Secrets.ServerSecretStore, {
          get: () => Effect.succeed(Option.none()),
          set: () => Effect.void,
          create: () => Effect.void,
          remove: () => Effect.void,
          getOrCreateRandom: () => Effect.die("Unused credentials"),
        }),
        Layer.succeed(Agent.InboxAgent, {
          start: () => Effect.void,
          stop: () => Effect.void,
          status: () =>
            Effect.succeed({ exists: false, running: false, settled: false, error: null }),
        }),
        Layer.succeed(Research.InboxResearch, {
          research: () => Effect.succeed({ suggestions: [] }),
        }),
        Layer.succeed(Analysis.InboxAnalysis, { analyze: () => Effect.die("Summary disabled") }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("No external HTTP allowed")),
        ),
        Config.layerTest(process.cwd(), { prefix: "t3-inbox-reply-history-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
        NodeServices.layer,
      );
      const inbox = Inbox.layer.pipe(
        Layer.provideMerge(Repository.layer.pipe(Layer.provideMerge(base))),
      );
      const sources = Sources.layer.pipe(
        Layer.provideMerge(SourceTransport.layer.pipe(Layer.provideMerge(inbox))),
      );
      const layer = Reply.layer.pipe(Layer.provideMerge(sources));
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const source = yield* Sources.InboxSources;
        const repository = yield* Repository.InboxRepository;
        const target = { source: "linear" as const, issueId: "issue", parentId: null };
        const preview = { ...issue(), comments: [comments[2]!], commentsComplete: false };
        const item = {
          id: "notification",
          source: "linear" as const,
          connectionId: "fixture:me",
          groupId: "issue",
          author: "Tars",
          location: "F-1",
          title: "Agent discussion",
          content: "Please review",
          url: "https://linear.app/fixture/issue/F-1",
          occurredAt: "2026-10-22T10:02:00Z",
          replyTarget: target,
          linearIssue: preview,
        };
        yield* service.ingest(projectId, [item]);
        const [notification] = yield* service.list({ projectId });
        assert.ok(notification);
        const linked = ThreadId.make("linked");
        const detail = (yield* service.get({ projectId, id: notification.id }))!;
        yield* repository.put({ ...detail, state: { ...detail.state, threadId: linked } });
        const history = yield* source
          .get({ projectId, id: notification.id, loadPreviousComments: true })
          .pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        const input = {
          projectId,
          id: notification.id,
          itemId: item.id,
          target,
          text: "Accepted during history load",
          commandId: CommandId.make("rejected"),
        };
        assert.equal((yield* service.reply(input)).status, "failed");
        assert.equal(posts, 0);
        reject = false;
        const accepted = { ...input, commandId: CommandId.make("accepted") };
        assert.equal((yield* service.reply(accepted)).status, "sent");
        assert.equal((yield* service.reply(accepted)).status, "sent");
        assert.equal(posts, 1);
        yield* Deferred.succeed(release, undefined);
        const hydrated = (yield* Fiber.join(history))!;
        assert.deepEqual(
          hydrated.linearIssue?.comments.map((c) => c.id),
          ["old-0", "old-1", "old-2", "accepted"],
        );
        assert.equal(hydrated.linearIssue?.commentsComplete, true);
        assert.equal(hydrated.linearIssue?.commentCount, 4);
        assert.equal(hydrated.state.threadId, linked);
        assert.equal((yield* service.list({ projectId })).length, showOwn ? 1 : 0);
        assert.equal((yield* service.list({ projectId, threadId: linked })).length, 1);
        assert.equal(
          (yield* source.get({ projectId, id: notification.id }))?.linearIssue?.comments.length,
          4,
        );
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped),
);
