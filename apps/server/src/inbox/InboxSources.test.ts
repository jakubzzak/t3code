import * as Linear from "../linear/LinearConnection.ts";
import * as Slack from "./SlackConnection.ts";
import * as HttpClient from "effect/http/HttpClient";
import * as Superhuman from "./SuperhumanConnection.ts";
import * as Redacted from "effect/Redacted";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Fiber from "effect/Fiber";
import * as Deferred from "effect/Deferred";
import * as TestClock from "effect/testing/TestClock";
import {
  InboxError,
  ProjectId,
  type InboxSourceItem,
  type InboxNotification,
} from "@t3tools/contracts";
import * as Sources from "./InboxSources.ts";
import { ingestInboxItem } from "./inboxState.ts";
import * as Transport from "./InboxSourceTransport.ts";
import * as Inbox from "./InboxService.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Settings from "../serverSettings.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SqlClient from "effect/sql/SqlClient";
it.effect(
  "honors project cadence and source checkpoints, isolates slow or paused sources, and disconnects",
  () =>
    Effect.gen(function* () {
      const credentials = new Map<string, Uint8Array>();
      const calls = yield* Ref.make(0);
      const fail = yield* Ref.make(false);
      const boundaries: string[] = [];
      let trackedConversations: ReadonlyArray<Pick<InboxSourceItem, "connectionId" | "groupId">> =
        [];
      const imported: InboxSourceItem[] = [];
      let historyItems: InboxSourceItem[] = [];
      let pendingRead:
        | {
            projectId?: ProjectId;
            entered: Deferred.Deferred<void>;
            release: Deferred.Deferred<void>;
          }
        | undefined;
      let pendingStarts = 0;
      const ingested = yield* Ref.make(0);
      const linearConnected = yield* Ref.make(false);
      let linearRead = yield* Deferred.make<void>();
      let linearReads = 0;
      const secrets = Secrets.ServerSecretStore.of({
        get: (key) => Effect.sync(() => Option.fromUndefinedOr(credentials.get(key))),
        set: (key, value) =>
          Effect.sync(() => {
            credentials.set(key, value);
          }),
        create: (key, value) =>
          Effect.sync(() => {
            credentials.set(key, value);
          }),
        remove: (key) =>
          Effect.sync(() => {
            credentials.delete(key);
          }),
        getOrCreateRandom: () => Effect.die("Not used in this test"),
      });
      let threadNotification: InboxNotification | null = null;
      const threadReads: string[] = [];
      const linearDetailReads: Array<{ id: string; comments: boolean }> = [];
      let failLinearDetail = false;
      const linearIssue = {
        id: "issue",
        title: "Review release",
        description: "Separated issue context",
        commentCount: 1,
        comments: [
          { id: "comment", author: "Maya", body: "Review", occurredAt: "2026-10-22T10:00:00Z" },
        ],
        commentsComplete: true,
      };
      let failThread = true;
      const msg = (ts: string) => ({
        images: [],
        ts,
        author: "Alex",
        content: "Message",
        formattedContent: "Message",
        occurredAt: "2026-10-22T10:00:00Z",
      });
      const imageReads: { url: string; account: string }[] = [];
      const transport = Transport.InboxSourceTransport.of({
        readImage: (_token, url, account) =>
          Effect.sync(() => {
            imageReads.push({ url, account });
            return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
          }),
        readThread: (_token, channelId, ts, cached) =>
          Effect.gen(function* () {
            const cursor = cached?.nextCursor ?? "initial";
            threadReads.push(cursor);
            if (cursor === "page3" && failThread)
              return yield* new InboxError({ detail: "Slack rate limit" });
            if (cached?.formatVersion !== 2)
              return {
                formatVersion: 2 as const,
                channelId,
                ts,
                root: msg(ts),
                latestReplyTs: "4",
                replyCount: 3,
                messages: [msg("4")],
                nextCursor: "page2",
              };
            return {
              ...cached,
              messages: [...cached.messages, msg(cursor === "page2" ? "2" : "3")],
              nextCursor: cursor === "page2" ? "page3" : null,
            };
          }),
        read: (connection, _token, since, tracked = []) =>
          Effect.gen(function* () {
            boundaries.push(since);
            trackedConversations = tracked;
            const waiting = pendingRead;
            if (waiting && (!waiting.projectId || waiting.projectId === connection.projectId)) {
              pendingStarts++;
              yield* Deferred.succeed(waiting.entered, undefined);
              yield* Deferred.await(waiting.release);
            }
            if (connection.source === "linear") {
              linearReads++;
              yield* Deferred.succeed(linearRead, undefined);
              return { items: historyItems };
            }
            yield* Ref.update(calls, (count) => count + 1);
            if (yield* Ref.get(fail))
              return yield* new InboxError({ detail: "Slack permission missing" });
            return { items: historyItems };
          }),
      });
      const inbox = Inbox.InboxService.of({
        reply: () => Effect.die("Not used"),
        cacheLinearIssue: (input) =>
          Effect.sync(() => {
            threadNotification = threadNotification
              ? { ...threadNotification, linearIssue: input.issue }
              : null;
            return threadNotification;
          }),
        cacheSlackThread: (input) =>
          Effect.sync(() => {
            threadNotification = threadNotification
              ? { ...threadNotification, slackThread: input.thread }
              : null;
            return threadNotification;
          }),
        list: () => Effect.succeed([]),
        get: (input) =>
          Effect.succeed(
            threadNotification?.projectId === input.projectId && threadNotification.id === input.id
              ? threadNotification
              : null,
          ),
        mutate: () => Effect.die("Not used"),
        drain: Effect.void,
        drainAnalysis: Effect.void,
        drainResearch: Effect.void,
        ingest: (_project, items) =>
          Effect.sync(() => {
            imported.push(...items);
          }).pipe(Effect.andThen(Ref.update(ingested, (n) => n + 1))),
      });
      const settingsLayer = Settings.layerTest();
      const layer = Sources.layer.pipe(
        Layer.provide(
          Slack.layer.pipe(
            Layer.provide(
              Layer.succeed(
                HttpClient.HttpClient,
                HttpClient.make(() => Effect.die("No OAuth request expected")),
              ),
            ),
          ),
        ),
        Layer.provide(
          Layer.succeed(Linear.LinearConnection, {
            createComment: () => Effect.die("Not used"),
            readIssue: (_projectId, id, comments) =>
              Effect.gen(function* () {
                linearDetailReads.push({ id, comments });
                if (failLinearDetail)
                  return yield* new InboxError({ detail: "Linear is temporarily unavailable" });
                return linearIssue;
              }),
            request: () =>
              Ref.get(linearConnected).pipe(
                Effect.map((connected) => ({
                  configured: connected,
                  connection: connected
                    ? {
                        workspace: "fixture",
                        userId: "fixture",
                        name: "Fixture",
                        email: "fixture@example.test",
                      }
                    : null,
                })),
              ),
            begin: () => Effect.die("Not used"),
            complete: () => Effect.void,
            cancel: () => Effect.void,
            disconnect: () => Effect.void,
            prepareMigration: () => Effect.die("Not used"),
            importMigration: () => Effect.void,
            read: () => Effect.succeed([]),
          }),
        ),
        Layer.provide(
          Layer.succeed(Superhuman.SuperhumanConnection, {
            begin: () => Effect.die("Not used"),
            complete: () => Effect.die("Not used"),
            disconnect: () => Effect.void,
            read: () => Effect.succeed([]),
            catalog: () =>
              Effect.succeed({
                accounts: ["one@example.test", "two@example.test"],
                splits: [{ accountEmail: "one@example.test", id: "important", name: "Important" }],
                labels: [{ accountEmail: "two@example.test", id: "work", name: "Work" }],
              }),
          }),
        ),
        Layer.provideMerge(Sqlite.layerMemory),
        Layer.provideMerge(settingsLayer),
        Layer.provide(Layer.succeed(Secrets.ServerSecretStore, secrets)),
        Layer.provide(Layer.succeed(Transport.InboxSourceTransport, transport)),
        Layer.provide(Layer.succeed(Inbox.InboxService, inbox)),
      );
      yield* Effect.gen(function* () {
        const service = yield* Sources.InboxSources;
        const settings = yield* Settings.ServerSettingsService;
        const projectId = ProjectId.make("one");
        for (const source of ["slack", "linear", "superhuman"] as const) {
          const cleared = yield* service.configure({
            projectId,
            source,
            enabled: false,
            categories: [],
            accounts: [],
          });
          assert.equal(cleared.enabled, true);
          assert.deepEqual(cleared.categories, []);
        }
        const accountOnly = yield* service.configure({
          projectId,
          source: "superhuman",
          enabled: false,
          accounts: ["one@example.test"],
          categories: [],
        });
        assert.deepEqual(accountOnly.accounts, ["one@example.test"]);
        assert.equal(
          (yield* Effect.result(
            service.configure({
              projectId,
              source: "superhuman",
              enabled: false,
              accounts: ["one@example.test"],
              categories: ["label:Work"],
            }),
          ))._tag,
          "Failure",
        );
        assert.equal(
          (yield* Effect.result(
            service.configure({
              projectId,
              source: "linear",
              enabled: false,
              categories: ["unsupported"],
            }),
          ))._tag,
          "Failure",
        );
        const input = {
          projectId,
          source: "slack" as const,
          enabled: false, // Retained wire flag must not require a second opt-in.
          categories: ["dms"],
          token: Redacted.make("xoxp-fixture-not-a-real-credential"),
        };
        const configured = yield* service.configure(input);
        const sql = yield* SqlClient.SqlClient;
        const legacy = JSON.stringify({ ...configured, enabled: false });
        yield* sql`UPDATE inbox_sources SET payload_json=${legacy} WHERE project_id=${projectId} AND source='slack'`;
        assert.equal((yield* service.list(projectId))[0]?.enabled, true);
        yield* service.refresh(input);
        assert.equal(yield* Ref.get(calls), 0);
        const foreign = yield* service.list(ProjectId.make("two"));
        assert.equal(foreign[0]?.connected, false);
        yield* settings.updateSettings({
          projectSettingsOverrides: { [projectId]: { inboxEnabled: true } },
        });
        const { token: _unusedToken, ...connectedInput } = input;
        const noCategories = { ...connectedInput, categories: [] };
        yield* service.configure(noCategories);
        yield* service.refresh(noCategories);
        assert.equal(yield* Ref.get(calls), 0);
        yield* service.configure(input);
        const trackedFixture = ingestInboxItem(projectId, {
          id: "tracked",
          source: "slack",
          connectionId: "T1:me",
          groupId: "C1:123",
          location: "#launch",
          title: "Review",
          author: "Alex",
          content: "Please review",
          url: "https://slack.com/x",
          occurredAt: "2026-10-22T10:00:00Z",
        });
        yield* sql`INSERT INTO inbox_notifications (id, project_id, updated_at, payload_json) VALUES (${trackedFixture.id}, ${projectId}, ${trackedFixture.updatedAt}, ${JSON.stringify(trackedFixture)})`;
        const synced = yield* service.refresh(input);
        assert.deepEqual(trackedConversations, [{ connectionId: "T1:me", groupId: "C1:123" }]);
        assert.ok(synced.lastSyncAt);
        assert.equal(yield* Ref.get(ingested), 1);
        threadNotification = ingestInboxItem(projectId, {
          id: "thread",
          source: "slack",
          connectionId: "team",
          groupId: "C1:1",
          location: "DM",
          title: "Root",
          author: "Alex",
          content: "Root",
          contentFormat: "text",
          url: "https://slack.com",
          occurredAt: "2026-10-22T10:00:00Z",
        });
        const threadId = threadNotification.id;
        yield* service.get({ projectId, id: threadId });
        threadNotification = {
          ...threadNotification!,
          slackThread: {
            ...threadNotification!.slackThread!,
            root: {
              ...threadNotification!.slackThread!.root,
              images: [{ id: "F1", name: "shot.png", url: "https://files.slack.com/shot.png" }],
            },
          },
        };
        assert.deepEqual(
          (yield* service.image({ projectId, notificationId: threadId, fileId: "F1" })).bytes,
          new Uint8Array([1, 2, 3]),
        );
        assert.deepEqual(imageReads, [
          { url: "https://files.slack.com/shot.png", account: "team" },
        ]);
        for (const bad of [
          { projectId: ProjectId.make("other"), notificationId: threadId, fileId: "F1" },
          { projectId, notificationId: "other", fileId: "F1" },
          { projectId, notificationId: threadId, fileId: "unknown" },
        ])
          assert.equal((yield* service.image(bad).pipe(Effect.result))._tag, "Failure");
        assert.equal(imageReads.length, 1);

        assert.deepEqual(threadReads, ["initial"]);
        assert.equal(
          (yield* Effect.result(
            service.get({ projectId, id: threadId, loadPreviousComments: true }),
          ))._tag,
          "Failure",
        );
        assert.equal(threadNotification.slackThread?.nextCursor, "page3");
        failThread = false;
        yield* service.get({ projectId, id: threadId, loadPreviousComments: true });
        yield* service.get({ projectId, id: threadId, loadPreviousComments: true });
        assert.deepEqual(threadReads, ["initial", "page2", "page3", "page3"]);
        assert.equal(threadNotification.slackThread?.nextCursor, null);
        const { formatVersion: _version, ...oldThread } = threadNotification.slackThread!;
        threadNotification = { ...threadNotification, slackThread: oldThread };
        yield* service.get({ projectId, id: threadId });
        assert.equal(threadReads.at(-1), "initial");
        assert.equal(threadNotification.slackThread?.formatVersion, 2);
        assert.equal(threadNotification.slackThread?.nextCursor, "page2");
        const readsAfterUpgrade = threadReads.length;
        yield* service.get({ projectId, id: threadId });
        assert.equal(threadReads.length, readsAfterUpgrade);
        threadNotification = ingestInboxItem(projectId, {
          id: "linear-notification",
          source: "linear",
          connectionId: "team",
          groupId: "issue",
          location: "ENG-1",
          title: "Maya commented",
          author: "Maya",
          content: "Old flattened body",
          url: "https://linear.app/fixture/issue/ENG-1",
          occurredAt: "2026-10-22T10:00:00Z",
        });
        const linearNotificationId = threadNotification.id;
        yield* service.get({ projectId, id: linearNotificationId });
        yield* service.get({ projectId, id: linearNotificationId });
        assert.deepEqual(linearDetailReads, [{ id: "issue", comments: true }]);
        const { linearIssue: _cachedIssue, ...withoutCachedIssue } = threadNotification;
        threadNotification = {
          ...withoutCachedIssue,
          items: threadNotification.items.map((item) => ({
            ...item,
            linearIssue: { ...linearIssue, commentsComplete: false },
          })),
        };
        yield* service.get({ projectId, id: linearNotificationId });
        assert.equal(linearDetailReads.length, 1);
        failLinearDetail = true;
        assert.equal(
          (yield* Effect.result(
            service.get({ projectId, id: linearNotificationId, loadPreviousComments: true }),
          ))._tag,
          "Failure",
        );
        assert.equal(threadNotification.linearIssue, undefined);
        failLinearDetail = false;
        yield* service.get({ projectId, id: linearNotificationId, loadPreviousComments: true });
        yield* service.get({ projectId, id: linearNotificationId, loadPreviousComments: true });
        assert.equal(linearDetailReads.length, 3);
        assert.equal(threadNotification.linearIssue?.commentsComplete, true);
        threadNotification = null;
        assert.equal(yield* Ref.get(calls), 1);
        yield* settings.updateSettings({
          projectSettingsOverrides: { [projectId]: { inboxEnabled: false } },
        });
        yield* service.refresh(input);
        assert.equal(yield* Ref.get(calls), 1);
        assert.equal((yield* service.list(projectId))[0]?.connected, true);
        yield* settings.updateSettings({
          projectSettingsOverrides: { [projectId]: { inboxEnabled: true } },
        });
        yield* Ref.set(fail, true);
        const { token: _token, ...withoutToken } = input;
        yield* service.configure(withoutToken);
        const failed = yield* service.refresh(input);
        assert.equal(failed.lastSyncAt, synced.lastSyncAt);
        assert.equal(failed.error, "Slack permission missing");
        assert.ok(failed.retryAt);
        yield* service.disconnect(input);
        assert.equal(credentials.size, 0);
        assert.equal((yield* service.list(projectId))[0]?.connected, false);
        assert.equal(
          (yield* Effect.result(service.configure({ ...input, categories: ["saved"] })))._tag,
          "Failure",
        );
        const linearProject = ProjectId.make("linear-only");
        credentials.set(`inbox-linear-${linearProject}`, new TextEncoder().encode("fixture"));
        yield* Ref.set(linearConnected, true);
        yield* Ref.set(fail, false);
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [linearProject]: { inboxEnabled: true, linearWorkspace: "fixture" },
          },
        });
        // No Inbox source row or client configure call: the existing project connection is sufficient.
        yield* TestClock.adjust("1 minute");
        yield* Deferred.await(linearRead);
        const linearSynced = yield* service.refresh({ projectId: linearProject, source: "linear" });
        assert.equal(linearSynced.connected, true);
        assert.ok(linearSynced.lastSyncAt);
        // The server owns cadence, defaults to two minutes, and reacts to project edits.
        const initialReads = linearReads;
        linearRead = yield* Deferred.make<void>();
        yield* TestClock.adjust("1 minute");
        assert.equal(linearReads, initialReads);
        yield* TestClock.adjust("1 minute");
        yield* Deferred.await(linearRead);
        assert.equal(linearReads, initialReads + 1);
        const scheduled = (yield* service.list(linearProject)).find(
          (entry) => entry.source === "linear",
        )!;
        assert.equal(boundaries.at(-1), linearSynced.lastSyncAt);
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [linearProject]: {
              inboxEnabled: true,
              linearWorkspace: "fixture",
              inboxRefreshIntervalMinutes: 60,
            },
          },
        });
        yield* TestClock.adjust("59 minutes");
        assert.equal(linearReads, initialReads + 1);
        linearRead = yield* Deferred.make<void>();
        yield* TestClock.adjust("1 minute");
        yield* Deferred.await(linearRead);
        assert.equal(linearReads, initialReads + 2);
        assert.equal(boundaries.at(-1), scheduled.lastSyncAt);
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [linearProject]: {
              inboxEnabled: true,
              linearWorkspace: "fixture",
              inboxRefreshIntervalMinutes: 2,
            },
          },
        });
        linearRead = yield* Deferred.make<void>();
        yield* TestClock.adjust("2 minutes");
        yield* Deferred.await(linearRead);
        assert.equal(linearReads, initialReads + 3);
        // One slow source cannot block another project's scheduled reads or queue duplicates.
        const slowProject = ProjectId.make("slow-superhuman");
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [slowProject]: { inboxEnabled: true, inboxInitialHistoryDays: 0 },
          },
        });
        const slowConnection = {
          ...(yield* service.list(slowProject)).find((entry) => entry.source === "superhuman")!,
          connected: true,
          accounts: ["one@example.test"],
        };
        yield* sql`INSERT INTO inbox_sources(project_id,source,payload_json) VALUES(${slowProject},'superhuman',${JSON.stringify(slowConnection)})`;
        credentials.set(`inbox-superhuman-${slowProject}`, new TextEncoder().encode("fixture"));
        pendingRead = {
          projectId: slowProject,
          entered: yield* Deferred.make<void>(),
          release: yield* Deferred.make<void>(),
        };
        yield* TestClock.adjust("15 seconds");
        yield* Deferred.await(pendingRead.entered);
        const slowStarted = yield* Clock.currentTimeMillis;
        linearRead = yield* Deferred.make<void>();
        yield* TestClock.adjust("2 minutes");
        yield* Deferred.await(linearRead);
        assert.equal(pendingStarts, 1);
        assert.equal(linearReads, initialReads + 4);
        yield* Deferred.succeed(pendingRead.release, undefined);
        pendingRead = undefined;
        yield* service.refresh({ projectId: slowProject, source: "superhuman" });
        assert.equal(boundaries.at(-1), DateTime.formatIso(DateTime.makeUnsafe(slowStarted)));
        yield* settings.updateSettings({
          projectSettingsOverrides: { [slowProject]: { inboxEnabled: false } },
        });
        // Each source uses the same enable-time boundary, even when connected later.
        for (const source of ["slack", "linear", "superhuman"] as const) {
          const id = ProjectId.make(`zero-${source}`);
          yield* settings.updateSettings({
            projectSettingsOverrides: {
              [id]: { inboxEnabled: true, inboxInitialHistoryDays: 0, linearWorkspace: "fixture" },
            },
          });
          const enabled = yield* Clock.currentTimeMillis;
          const item = (offset: number): InboxSourceItem => ({
            id: String(offset),
            source,
            connectionId: "fixture",
            groupId: String(offset),
            location: "fixture",
            title: "Fixture",
            author: "Fixture",
            content: "Fixture",
            url: "https://example.test",
            occurredAt: DateTime.formatIso(DateTime.makeUnsafe(enabled + offset)),
          });
          historyItems = [-1, 0, 1].map(item);
          const connection = {
            ...(yield* service.list(id)).find((entry) => entry.source === source)!,
            connected: true,
            categories:
              source === "superhuman"
                ? ["split:Important"]
                : source === "slack"
                  ? ["dms"]
                  : ["all"],
            accounts: ["one@example.test"],
            initialLookbackDays: 90,
          };
          yield* sql`INSERT INTO inbox_sources(project_id,source,payload_json) VALUES(${id},${source},${JSON.stringify(connection)})`;
          credentials.set(
            `inbox-${source}-${id}`,
            new TextEncoder().encode("xoxp-fixture-not-a-real-credential"),
          );
          yield* TestClock.adjust(2);
          const before = imported.length;
          yield* service.refresh({ projectId: id, source });
          assert.equal(boundaries.at(-1), DateTime.formatIso(DateTime.makeUnsafe(enabled)));
          assert.deepEqual(
            imported.slice(before).map((entry) => entry.id),
            ["0", "1"],
          );
          const checkpoint = (yield* service.list(id)).find(
            (entry) => entry.source === source,
          )!.lastSyncAt;
          const beforeIncremental = imported.length;
          yield* service.refresh({ projectId: id, source });
          assert.equal(boundaries.at(-1), checkpoint);
          assert.equal(imported.length, beforeIncremental);
          // Changing the shared policy must backfill instead of reusing the zero-day cursor.
          yield* settings.updateSettings({
            projectSettingsOverrides: {
              [id]: { inboxEnabled: true, inboxInitialHistoryDays: 30, linearWorkspace: "fixture" },
            },
          });
          const now = yield* Clock.currentTimeMillis;
          yield* service.refresh({ projectId: id, source });
          assert.equal(
            boundaries.at(-1),
            DateTime.formatIso(DateTime.makeUnsafe(now - 30 * 86_400_000)),
          );
          // Legacy per-source history is ignored; changing it cannot reset the cursor.
          const previous = (yield* service.list(id)).find((entry) => entry.source === source)!;
          const updated = yield* service.configure({
            projectId: id,
            source,
            enabled: true,
            categories: connection.categories,
            accounts: connection.accounts,
            initialLookbackDays: 30,
          });
          assert.equal(updated.initialLookbackDays, 90);
          assert.equal(updated.lastSyncAt, previous.lastSyncAt);
          if (source === "superhuman") {
            const withAccount = yield* service.configure({
              projectId: id,
              source,
              enabled: true,
              categories: connection.categories,
              accounts: ["one@example.test", "two@example.test"],
            });
            assert.equal(withAccount.lastSyncAt, null);
            yield* service.refresh({ projectId: id, source });
            assert.equal(
              boundaries.at(-1),
              DateTime.formatIso(DateTime.makeUnsafe(now - 30 * 86_400_000)),
            );
          }
          yield* settings.updateSettings({
            projectSettingsOverrides: {
              [id]: { inboxEnabled: true, inboxInitialHistoryDays: 7, linearWorkspace: "fixture" },
            },
          });
          yield* Ref.set(fail, true);
          if (source === "slack") {
            const failedHistory = yield* service.refresh({ projectId: id, source });
            assert.equal(failedHistory.collectionHistoryDays, 30);
          }
          yield* Ref.set(fail, false);
          yield* service.refresh({ projectId: id, source });
          assert.equal(
            boundaries.at(-1),
            DateTime.formatIso(DateTime.makeUnsafe(enabled - 7 * 86_400_000)),
          );
        }

        // An older client left a recent cursor but no policy checkpoint. A first shared edit to
        // thirty days must still backfill, rather than silently continuing that cursor.
        const legacyId = ProjectId.make("legacy-history");
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [legacyId]: { inboxEnabled: true, inboxInitialHistoryDays: 30 },
          },
        });
        const now = yield* Clock.currentTimeMillis;
        const legacyConnection = {
          ...(yield* service.list(legacyId))[0]!,
          connected: true,
          lastSyncAt: DateTime.formatIso(DateTime.makeUnsafe(now - 1_000)),
        };
        yield* sql`INSERT INTO inbox_sources(project_id,source,payload_json) VALUES(${legacyId},'slack',${JSON.stringify(legacyConnection)})`;
        credentials.set(
          `inbox-slack-${legacyId}`,
          new TextEncoder().encode("xoxp-fixture-not-a-real-credential"),
        );
        yield* service.refresh({ projectId: legacyId, source: "slack" });
        assert.equal(
          boundaries.at(-1),
          DateTime.formatIso(DateTime.makeUnsafe(now - 30 * 86_400_000)),
        );
        // A delayed old-policy response cannot import history after the project changes to zero.
        const id = ProjectId.make("zero-superhuman");
        const before = imported.length;
        const lastSync = (yield* service.list(id)).find(
          (entry) => entry.source === "superhuman",
        )!.lastSyncAt;
        pendingRead = {
          entered: yield* Deferred.make<void>(),
          release: yield* Deferred.make<void>(),
        };
        const refresh = yield* service
          .refresh({ projectId: id, source: "superhuman" })
          .pipe(Effect.forkChild);
        yield* Deferred.await(pendingRead.entered);
        yield* settings.updateSettings({
          projectSettingsOverrides: { [id]: { inboxEnabled: true, inboxInitialHistoryDays: 0 } },
        });
        yield* Deferred.succeed(pendingRead.release, undefined);
        yield* Fiber.join(refresh);
        assert.equal(imported.length, before);
        assert.equal(
          (yield* service.list(id)).find((entry) => entry.source === "superhuman")!.lastSyncAt,
          lastSync,
        );
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped),
);
