import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CommandId,
  InboxError,
  ProjectId,
  ProviderInstanceId,
  type InboxMutation,
} from "@t3tools/contracts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Settings from "../serverSettings.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Linear from "../linear/LinearConnection.ts";
import * as Slack from "./SlackConnection.ts";
import * as Superhuman from "./SuperhumanConnection.ts";
import * as Sources from "./InboxSources.ts";
import * as Transport from "./InboxSourceTransport.ts";
import * as Inbox from "./InboxService.ts";
import * as Repository from "./InboxRepository.ts";
import * as Context from "./InboxContextService.ts";
import * as Analysis from "./InboxAnalysis.ts";
import * as Research from "./InboxResearch.ts";
import * as Agent from "./InboxAgent.ts";
import { inboxContext } from "./notificationContext.ts";
import { readLinearInbox } from "./connectors/linear.ts";
import { readSuperhumanInbox } from "./connectors/superhuman.ts";

it.effect.each(["slack", "linear", "superhuman"] as const)(
  "%s: refresh persists replies, summary and linked context, and retries without skipping activity",
  (source) =>
    Effect.gen(function* () {
      const projectId = ProjectId.make(`sync-${source}`);
      const start = Date.parse("2026-10-22T12:00:00Z");
      yield* TestClock.setTime(start);
      let phase = 0;
      let fail = false;
      let starts = 0;
      let command = 0;
      const at = (n: number) => DateTime.formatIso(DateTime.makeUnsafe(start + n * 1000));
      const ts = (n: number) => String((start + n * 1000) / 1000);
      const text = () =>
        phase === 0
          ? "Please review"
          : phase === 1
            ? "SELF: Friday confirmed"
            : "INCOMING: Monday instead";
      const author = () => (phase === 1 ? "me" : "alex");
      const root = {
        ts: ts(-60),
        user: "alex",
        text: "Please review",
        reply_count: phase ? 1 : 0,
        latest_reply: phase ? ts(phase) : undefined,
      };
      const current = () => ({
        ts: phase ? ts(phase) : root.ts,
        thread_ts: root.ts,
        user: author(),
        text: text(),
      });
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          const url = new URL(request.url);
          const method = url.pathname.split("/").at(-1);
          let body: unknown;
          if (method === "auth.test") body = { ok: true, user_id: "me", team_id: "T" };
          else if (method === "users.info") body = { user: { name: url.searchParams.get("user") } };
          else if (method === "search.messages")
            body = {
              ok: true,
              messages: {
                matches:
                  phase === 0 || url.searchParams.get("query")?.startsWith("is:thread")
                    ? [
                        {
                          ...current(),
                          channel: { id: "C", name: "review" },
                          permalink: `https://slack.com/archives/C/p1?thread_ts=${root.ts}`,
                        },
                      ]
                    : [],
                paging: { pages: 1 },
              },
            };
          else if (method === "conversations.replies") {
            if (fail) return HttpClientResponse.fromWeb(request, new Response("", { status: 429 }));
            body = {
              ok: true,
              messages: url.searchParams.has("oldest")
                ? [current()]
                : [root, ...(phase ? [current()] : [])],
            };
          } else throw new Error(`Unexpected Slack operation: ${method}`);
          return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body)));
        }),
      );
      const wrap = (cause: unknown) => new InboxError({ detail: String(cause) });
      const linear = Layer.succeed(Linear.LinearConnection, {
        begin: () => Effect.die("Unused"),
        complete: () => Effect.void,
        cancel: () => Effect.void,
        disconnect: () => Effect.void,
        prepareMigration: () => Effect.die("Unused"),
        importMigration: () => Effect.void,
        request: () =>
          Effect.succeed({
            configured: true,
            connection: {
              workspace: "fixture",
              userId: "me",
              name: "Me",
              email: "me@example.com",
            },
          }),
        readIssue: () => Effect.succeed(null),
        read: (_project, categories, since, tracked) =>
          Effect.tryPromise({
            try: () =>
              readLinearInbox(
                async (query, variables) => {
                  if (fail) throw new Error("Linear unavailable");
                  const comment = {
                    id: `c${phase}`,
                    body: text(),
                    createdAt: at(phase || -60),
                    user: { id: author(), name: author() },
                    projectUpdate: { id: "update" },
                    parent: phase ? { id: "c0" } : null,
                  };
                  if (query.includes("BlackbirdInboxReplies"))
                    return {
                      data: {
                        comments: {
                          nodes: [
                            { ...comment, issue: null, url: "https://linear.app/project/update" },
                          ],
                          pageInfo: { hasNextPage: false, endCursor: null },
                        },
                      },
                    };
                  return {
                    data: {
                      viewer: { id: "me" },
                      organization: { id: "org" },
                      notifications: {
                        nodes:
                          phase && !variables.notificationIds?.includes("n")
                            ? []
                            : [
                                {
                                  id: "n",
                                  type: "projectUpdateComment",
                                  category: "comments",
                                  title: "Project review",
                                  subtitle: "Project",
                                  url: "https://linear.app/project/update",
                                  groupingKey: "opaque-group",
                                  createdAt: at(-60),
                                  actor: { name: "alex" },
                                  project: { id: "project", name: "Review", description: null },
                                  comment: {
                                    ...comment,
                                    id: "c0",
                                    parent: null,
                                    body: "Please review",
                                    createdAt: at(-60),
                                    user: { id: "alex", name: "alex" },
                                  },
                                },
                              ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                  };
                },
                categories,
                since,
                tracked,
              ),
            catch: wrap,
          }),
      });
      const superhuman = Layer.succeed(Superhuman.SuperhumanConnection, {
        begin: () => Effect.die("Unused"),
        complete: () => Effect.die("Unused"),
        disconnect: () => Effect.void,
        catalog: () => Effect.succeed({ accounts: ["me@example.com"], splits: [], labels: [] }),
        read: (_project, accounts, categories, since, tracked) =>
          Effect.tryPromise({
            try: () =>
              readSuperhumanInbox(
                async (name) => {
                  if (fail) throw new Error("Mail unavailable");
                  if (name === "list_accounts")
                    return { accounts: [{ accountEmail: "me@example.com", isPrimary: true }] };
                  const thread = {
                    thread_id: "mail",
                    subject: "Review",
                    snippet: text(),
                    last_message_at: at(phase || -60),
                    last_message_id: `m${phase}`,
                    labels: [],
                    splits: ["Important"],
                  };
                  if (name === "list_threads") return { threads: [thread] };
                  return {
                    ...thread,
                    messages: [
                      {
                        message_id: "m0",
                        from: "alex@example.com",
                        sent_at: at(-60),
                        body: "Please review " + "A".repeat(33000),
                        snippet: "Review",
                      },
                      ...(phase
                        ? [
                            {
                              message_id: `m${phase}`,
                              from: `${author()}@example.com`,
                              sent_at: at(phase),
                              body: text(),
                              snippet: text(),
                            },
                          ]
                        : []),
                    ],
                  };
                },
                accounts,
                categories,
                since,
                tracked,
              ),
            catch: wrap,
          }),
      });
      const base = Layer.mergeAll(
        Sqlite.layerMemory,
        Settings.layerTest({
          projectSettingsOverrides: {
            [projectId]: { inboxEnabled: true, inboxSummaryEnabled: true },
          },
        }),
        linear,
        superhuman,
        Layer.succeed(HttpClient.HttpClient, client),
        Layer.succeed(Secrets.ServerSecretStore, {
          get: () => Effect.succeed(Option.some(new TextEncoder().encode("fixture"))),
          set: () => Effect.void,
          create: () => Effect.void,
          remove: () => Effect.void,
          getOrCreateRandom: () => Effect.die("Unused"),
        }),
        Layer.succeed(Slack.SlackConnection, {
          begin: () => Effect.die("Unused"),
          complete: () => Effect.die("Unused"),
          cancel: () => Effect.void,
          disconnect: () => Effect.void,
          accessToken: () => Effect.succeed("fixture"),
        }),
        Layer.succeed(Research.InboxResearch, { research: () => Effect.succeed([]) }),
        Layer.succeed(Agent.InboxAgent, {
          start: (_, run) =>
            Effect.sync(() => {
              if (run) starts++;
            }),
          stop: () => Effect.void,
          status: () =>
            Effect.succeed({ exists: true, running: false, settled: false, error: null }),
        }),
        Layer.succeed(Analysis.InboxAnalysis, {
          analyze: (notification) =>
            Effect.succeed({
              description: "Review",
              summary: inboxContext(notification).slice(0, 2000),
              suggestions: [],
              precedentIds: [],
              generatedAt: at(phase),
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
            }),
        }),
      );
      const services = Layer.mergeAll(Inbox.layer, Transport.layer, Context.layer).pipe(
        Layer.provideMerge(Repository.layer),
        Layer.provideMerge(base),
      );
      const layer = Sources.layer.pipe(Layer.provideMerge(services));
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const sources = yield* Sources.InboxSources;
        const inbox = yield* Inbox.InboxService;
        const repository = yield* Repository.InboxRepository;
        const context = yield* Context.InboxContext;
        const connection = {
          projectId,
          source,
          enabled: true,
          connected: true,
          categories:
            source === "slack" ? ["mentions"] : source === "linear" ? ["all"] : ["split:Important"],
          accounts: ["me@example.com"],
          initialLookbackDays: 7,
          lastSyncAt: null,
          error: null,
          retryAt: null,
        };
        yield* sql`INSERT INTO inbox_sources (project_id, source, payload_json) VALUES (${projectId}, ${source}, ${JSON.stringify(connection)})`;
        const firstSync = yield* sources.refresh({ projectId, source });
        assert.isNull(firstSync.error);
        yield* inbox.drainAnalysis;
        const [first] = yield* inbox.list({ projectId });
        assert.ok(first);
        const mutate = (action: InboxMutation) =>
          Effect.gen(function* () {
            const current = yield* repository.get(projectId, first.id);
            assert.ok(current);
            return yield* inbox.mutate({
              projectId,
              id: first.id,
              expectedRevision: current.revision,
              commandId: CommandId.make(`cmd-${++command}`),
              action,
            });
          });
        const linked = yield* mutate({ type: "delegate", startAgent: false });
        yield* inbox.drain;
        const threadId = linked.notification.state.threadId;
        assert.ok(threadId);
        yield* mutate({ type: "resolve", resolved: true });
        yield* mutate({ type: "read", read: false });
        if (source === "linear") {
          // Pre-upgrade saved items have no native comment target yet.
          yield* sql`UPDATE inbox_notifications SET payload_json=json_remove(payload_json, '$.items[0].linearCommentTarget') WHERE id=${first.id}`;
        }
        phase = 1;
        fail = true;
        yield* TestClock.setTime(start + 1000);
        const failed = yield* sources.refresh({ projectId, source });
        assert.ok(failed.error);
        assert.equal(failed.lastSyncAt, firstSync.lastSyncAt);
        assert.equal((yield* repository.get(projectId, first.id))?.state.read, false);
        fail = false;
        const recovered = yield* sources.refresh({ projectId, source });
        assert.isNull(recovered.error);
        yield* inbox.drainAnalysis;
        const own = yield* repository.get(projectId, first.id);
        assert.ok(own);
        assert.equal(own.state.read, true);
        assert.equal(own.state.placement, "resolved");
        assert.equal(own.state.threadId, threadId);
        assert.include(own.analysis?.summary ?? "", "SELF: Friday confirmed");
        assert.include(yield* context.forThread(projectId, threadId), "SELF: Friday confirmed");
        yield* mutate({ type: "read", read: false });
        yield* sources.refresh({ projectId, source });
        assert.equal((yield* repository.get(projectId, first.id))?.state.read, false);
        phase = 2;
        yield* TestClock.setTime(start + 2000);
        yield* sources.refresh({ projectId, source });
        yield* inbox.drainAnalysis;
        const incoming = yield* repository.get(projectId, first.id);
        assert.ok(incoming);
        assert.equal(incoming.state.placement, "active");
        assert.equal(incoming.state.read, false);
        assert.equal(incoming.state.threadId, threadId);
        assert.include(incoming.analysis?.summary ?? "", "INCOMING: Monday instead");
        assert.include(yield* context.forThread(projectId, threadId), "INCOMING: Monday instead");
        assert.equal((yield* repository.list(projectId)).length, 1);
        assert.equal(starts, 0);
      }).pipe(Effect.provide(layer));
    }),
);
