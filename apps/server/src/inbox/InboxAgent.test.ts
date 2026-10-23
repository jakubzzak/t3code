import { assert, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  ProviderDriverKind,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Projects from "../project/ProjectService.ts";
import * as ManagedFolders from "../project/ManagedProjectFolders.ts";
import * as SetupTracker from "../project/WorktreeSetupTracker.ts";
import * as CloneTracker from "../project/ProjectCloneTracker.ts";
import * as SetupScripts from "../project/ProjectSetupScriptRunner.ts";
import * as Git from "../git/GitWorkflowService.ts";
import * as Terminals from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectFiles from "../project/T3ProjectFileLoader.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Settings from "../serverSettings.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as Registry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as Replay from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as Agent from "./InboxAgent.ts";
import { ingestInboxItem } from "./inboxState.ts";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Receipts from "../orchestration-v2/CommandReceiptStore.ts";
const adapter = yieldAdapter();
function yieldAdapter() {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
    openSession: () => Effect.die("No provider process in command acceptance test"),
  } as ProviderAdapter.ProviderAdapterV2["Service"];
}
const database = Sqlite.layerMemory;
const runtime = Replay.layerWithRegistry(
  { name: "inbox-agent" },
  Registry.layerFromAdapters([adapter]),
  { databaseLayer: database, runEffectWorker: false },
);
const settings = Settings.layerTest({
  inboxAgentEnabled: true,
  inboxAgentPrompt: "",
  inboxAgentModelSelection: { instanceId: "codex", model: "gpt-5" },
});
function makeLayer(settingsLayer: typeof settings) {
  const receipts = Receipts.layer.pipe(Layer.provide(database));
  const threads = ThreadManagement.layer.pipe(
    Layer.provide(Layer.mergeAll(runtime, receipts, settingsLayer)),
  );
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectFiles.T3ProjectFileLoader)({ load: () => Effect.succeed(Option.none()) }),
    runtime,
    threads,
    receipts,
    settingsLayer,
    IdAllocator.layer,
    SetupTracker.layer,
    Layer.mock(Projects.ProjectService)({
      getById: (id) =>
        Effect.succeed(
          Option.some({
            id,
            title: "Inbox project",
            workspaceRoot: "/repo",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-10-22T10:00:00Z",
            updatedAt: "2026-10-22T10:00:00Z",
            deletedAt: null,
          }),
        ),
    }),
    Layer.mock(ManagedFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/projects",
      folderForThread: () => Effect.succeed(Option.none()),
    }),
    Layer.mock(CloneTracker.ProjectCloneTracker)({ get: () => Effect.succeed(null) }),
    Layer.mock(Terminals.TerminalManager)({ close: () => Effect.void }),
    Layer.mock(SetupScripts.ProjectSetupScriptRunner)({
      runForThread: () => Effect.succeed({ status: "no-script" as const }),
    }),
    Layer.mock(Git.GitWorkflowService)({}),
    Layer.mock(TextGeneration.TextGeneration)({}),
    ProviderRegistryMock.layer(),
  );
  return Agent.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(dependencies, ThreadLaunch.layer.pipe(Layer.provide(dependencies))),
    ),
  );
}
const layer = makeLayer(settings);
it.effect(
  "creates a compose-only chat, dispatches direct delegation once and retains the chat on stop",
  () =>
    Effect.gen(function* () {
      const agent = yield* Agent.InboxAgent;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("inbox-test-thread");
      const notification = ingestInboxItem(ProjectId.make("inbox-project"), {
        source: "slack",
        id: "one",
        connectionId: "team",
        groupId: "thread",
        location: "#launch",
        title: "Review notes",
        author: "Alex",
        content: "Review please",
        url: "https://slack.com",
        occurredAt: "2026-10-22T10:00:00Z",
      });
      const linked = {
        ...notification,
        state: { ...notification.state, threadId },
        agentAttempt: 1,
      };
      yield* agent.start(linked, false);
      const compose = yield* orchestrator.getThreadShell(threadId);
      assert.ok(compose);
      assert.equal(compose.latestRunId, null);
      yield* agent.start(linked, true);
      const started = yield* orchestrator.getThreadShell(threadId);
      assert.ok(started?.latestRunId);
      const timeline = yield* orchestrator.getTimelinePage(threadId, {
        limit: 10,
        view: "messages",
      });
      const message = timeline.items.find((entry) => entry.item.type === "user_message")?.item;
      assert.equal(
        message?.type === "user_message" ? message.text : null,
        DEFAULT_SERVER_SETTINGS.inboxAgentPrompt,
      );
      yield* agent.start(linked, true);
      assert.equal(
        (yield* orchestrator.getThreadShell(threadId))?.latestRunId,
        started.latestRunId,
      );
      yield* agent.stop(threadId, CommandId.make("undo-delegate"));
      assert.ok(yield* orchestrator.getThreadShell(threadId));
    }).pipe(Effect.provide(layer), Effect.scoped),
);

it.effect("uses the editable delegation prompt when Agent Delegation is enabled", () =>
  Effect.gen(function* () {
    const agent = yield* Agent.InboxAgent;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const settings = yield* Settings.ServerSettingsService;
    const projectId = ProjectId.make("inbox-project");
    yield* settings.updateSettings({
      projectSettingsOverrides: {
        [projectId]: {
          inboxAgentEnabled: true,
          inboxAgentPrompt: "Investigate without sending a reply.",
        },
      },
    });
    const notification = ingestInboxItem(projectId, {
      source: "slack",
      id: "custom",
      connectionId: "team",
      groupId: "custom",
      location: "#launch",
      title: "Review notes",
      author: "Alex",
      content: "Review please",
      url: "https://slack.com",
      occurredAt: "2026-10-22T10:00:00Z",
    });
    const threadId = ThreadId.make("custom-inbox-prompt");
    yield* settings.updateSettings({
      projectSettingsOverrides: { [projectId]: { inboxAgentEnabled: false } },
    });
    const blocked = yield* agent
      .start({ ...notification, state: { ...notification.state, threadId } }, true)
      .pipe(Effect.result);
    assert.equal(blocked._tag, "Failure");
    assert.equal(yield* orchestrator.getThreadShell(threadId), null);
    yield* settings.updateSettings({
      projectSettingsOverrides: {
        [projectId]: {
          inboxAgentEnabled: true,
          inboxAgentPrompt: "Investigate without sending a reply.",
        },
      },
    });

    yield* agent.start(
      { ...notification, state: { ...notification.state, threadId }, agentAttempt: 1 },
      true,
    );
    const timeline = yield* orchestrator.getTimelinePage(threadId, { limit: 10, view: "messages" });
    const message = timeline.items.find((entry) => entry.item.type === "user_message")?.item;
    assert.equal(
      message?.type === "user_message" ? message.text : null,
      "Investigate without sending a reply.",
    );
  }).pipe(Effect.provide(makeLayer(settings)), Effect.scoped),
);
