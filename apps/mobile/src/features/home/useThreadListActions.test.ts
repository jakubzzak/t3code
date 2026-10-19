import { makeThreadShellFixture } from "../../test-fixtures";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  type ScopedThreadRef,
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  taskList: vi.fn(),
  onDialog: undefined as (() => void) | undefined,
  pendingOrder: null as object | null,
  dropBusy: false,
  scopes: new Map<string, Set<string>>(),
  shells: [] as EnvironmentThreadShell[],
  requests: [] as {
    action: string;
    environmentId: string;
    input: { threadId: string; orderKey?: string };
  }[],
  dialogs: [] as { onConfirm: () => void; onCancel: () => void }[],
  alerts: [] as {
    title: string;
    buttons?: { text: string; onPress?: () => void }[];
  }[],
  afterRequest: undefined as (() => void) | undefined,
}));

vi.mock("@t3tools/client-runtime/state/thread-cleanup", () => ({
  requestThreadCleanup: async (target: ScopedThreadRef) => {
    if (!state.scopes.get(target.environmentId)?.has(AuthOrchestrationOperateScope)) return false;
    state.requests.push({
      action: "cleanup",
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    return true;
  },
}));
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return process.env.EXPO_OS;
    },
  },
  Alert: {
    alert: (
      title: string,
      _message: string,
      buttons?: { text: string; onPress?: () => void }[],
    ) => {
      state.alerts.push({ title, buttons });
      state.onDialog?.();
    },
  },
}));
vi.mock("expo-haptics", () => ({
  impactAsync: async () => {},
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("../../components/ConfirmDialogHost", () => ({
  showConfirmDialog: (dialog: { onConfirm: () => void; onCancel: () => void }) => {
    state.dialogs.push(dialog);
    state.onDialog?.();
  },
}));
vi.mock("../archive/useArchivedThreadSnapshots", () => ({
  refreshArchivedThreadsForEnvironment: () => {},
}));
vi.mock("../../state/session", () => ({
  readEnvironmentScope: (environmentId: string, scope: string) =>
    state.scopes.get(environmentId)?.has(scope) === true,
}));
vi.mock("../../state/server", () => ({
  environmentServerConfigsAtom: "server-configs",
  serverEnvironment: { scheduledTasks: "scheduled-tasks" },
}));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    set: (_atom: string, value: boolean) => {
      state.dropBusy = value;
    },
    get: (atom: string) =>
      atom === "thread-drop-busy"
        ? state.dropBusy
        : atom === "thread-shells"
          ? state.shells
          : atom === "queued-thread-keys"
            ? new Set<string>()
            : new Map(
                [...state.scopes.keys()].map((environmentId) => [
                  environmentId,
                  {
                    environment: {
                      capabilities: {
                        threadSettlement: true,
                        threadCleanup: true,
                        scheduledTaskChatBinding: true,
                        threadSnooze: true,
                        threadPinning: true,
                        threadPinReorder: true,
                        threadTitleRegeneration: true,
                      },
                    },
                  },
                ]),
              ),
  },
}));
vi.mock("../../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => state.taskList,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));
// Stubbed at the direct dependency: the real outbox pulls the Expo file-system
// storage into a test that only reads which threads are queued.
vi.mock("../../state/use-thread-outbox", () => ({ queuedThreadKeysAtom: "queued-thread-keys" }));
// The real hold lives in a module-level atom that would leak between cases.
vi.mock("../../state/thread-order", () => ({
  threadDropBusyAtom: "thread-drop-busy",
  getPendingThreadOrder: () => state.pendingOrder,
  beginPendingThreadOrder: () => {
    state.pendingOrder = {};
    return {
      isPending: () => state.pendingOrder !== null,
      complete: () => {
        state.pendingOrder = null;
      },
      cancel: () => {
        state.pendingOrder = null;
      },
    };
  },
}));
vi.mock("../../state/threads", () => ({
  environmentThreadShells: { threadShellsAtom: "thread-shells" },
  threadEnvironment: Object.fromEntries(
    [
      "archive",
      "unarchive",
      "delete",
      "settle",
      "unsettle",
      "snooze",
      "unsnooze",
      "pin",
      "unpin",
      "reorderPin",
      "updateMetadata",
    ].map((action) => [
      action,
      async (request: {
        environmentId: string;
        input: { threadId: string; orderKey?: string };
      }) => {
        state.requests.push({ action, ...request });
        if (!state.scopes.get(request.environmentId)?.has(AuthOrchestrationOperateScope)) {
          return AsyncResult.failure(Cause.fail(new Error("Thread operation denied")));
        }
        state.afterRequest?.();
        return AsyncResult.success(undefined);
      },
    ]),
  ),
}));

import { useArchivedThreadListActions, useThreadListActions } from "./useThreadListActions";

const primaryEnvironmentId = EnvironmentId.make("primary");
const otherEnvironmentId = EnvironmentId.make("other");

function makeThread(input: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return makeThreadShellFixture({
    id: ThreadId.make("thread"),
    title: "Thread",
    environmentId: primaryEnvironmentId,
    projectId: ProjectId.make("project"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
    ...input,
  });
}

const mutationCases = [
  ["archiveThread", "archive"],
  ["settleThread", "settle"],
  ["unsettleThread", "unsettle"],
  ["snoozeThread", "snooze"],
  ["unsnoozeThread", "unsnooze"],
  ["pinThread", "pin"],
  ["unpinThread", "unpin"],
  ["regenerateThreadTitle", "updateMetadata"],
] as const;

beforeEach(() => {
  state.taskList.mockReset().mockResolvedValue(AsyncResult.success({ tasks: [] }));
  state.onDialog = undefined;
  state.pendingOrder = null;
  state.dropBusy = false;
  state.scopes = new Map([
    [primaryEnvironmentId, new Set([AuthOrchestrationOperateScope])],
    [otherEnvironmentId, new Set<string>()],
  ]);
  state.requests = [];
  state.shells = [];
  state.dialogs = [];
  state.alerts = [];
  state.afterRequest = undefined;
});

afterEach(() => vi.unstubAllEnvs());

describe("thread list operation permissions", () => {
  it.each(mutationCases)(
    "%s rejects a retained callback after its environment loses permission",
    async (handler) => {
      const actions = useThreadListActions();
      state.scopes.get(primaryEnvironmentId)!.clear();

      await actions[handler](makeThread(), "2099-01-01T00:00:00.000Z");

      expect(state.requests).toEqual([]);
    },
  );

  it.each(mutationCases)("%s requires the target environment's permission", async (handler) => {
    await useThreadListActions()[handler](
      makeThread({ environmentId: otherEnvironmentId }),
      "2099-01-01T00:00:00.000Z",
    );

    expect(state.requests).toEqual([]);
  });

  it.each(mutationCases)(
    "%s works when the target environment gains only task permission",
    async (handler, action) => {
      state.scopes.get(primaryEnvironmentId)!.clear();
      const actions = useThreadListActions();
      state.scopes.get(otherEnvironmentId)!.add(AuthOrchestrationOperateScope);

      await actions[handler](
        makeThread({ environmentId: otherEnvironmentId }),
        "2099-01-01T00:00:00.000Z",
      );

      expect(state.requests).toEqual([
        expect.objectContaining({
          action: action === "settle" ? "cleanup" : action,
          environmentId: otherEnvironmentId,
        }),
      ]);
    },
  );

  it.each(["ios", "android"])("does not show a forbidden %s delete confirmation", (os) => {
    vi.stubEnv("EXPO_OS", os);
    useThreadListActions().confirmDeleteThread(makeThread({ environmentId: otherEnvironmentId }));

    expect(state.dialogs).toEqual([]);
    expect(state.alerts.some((alert) => alert.title === "Delete thread?")).toBe(false);
    expect(state.requests).toEqual([]);
  });

  it.each(["ios", "android"])(
    "rechecks permission after a retained %s delete confirmation",
    async (os) => {
      vi.stubEnv("EXPO_OS", os);
      useThreadListActions().confirmDeleteThread(makeThread());
      const confirm =
        os === "ios"
          ? state.alerts[0]?.buttons?.find((button) => button.text === "Delete")?.onPress
          : state.dialogs[0]?.onConfirm;
      expect(confirm).toBeTypeOf("function");
      state.scopes.get(primaryEnvironmentId)!.clear();

      await confirm!();

      expect(state.requests).toEqual([]);
    },
  );

  it("unarchives with only task permission and blocks a later revoked callback", async () => {
    const actions = useArchivedThreadListActions(() => {});
    const thread = makeThread({ archivedAt: "2026-09-02T00:00:00.000Z" });
    await actions.unarchiveThread(thread);
    expect(state.requests).toEqual([expect.objectContaining({ action: "unarchive" })]);
    state.requests = [];
    state.scopes.get(primaryEnvironmentId)!.clear();

    await actions.unarchiveThread(thread);

    expect(state.requests).toEqual([]);
  });

  it("keeps delete independent of terminal and source-control permissions", async () => {
    vi.stubEnv("EXPO_OS", "android");
    useArchivedThreadListActions(() => {}).confirmDeleteThread(makeThread());
    await state.dialogs[0]!.onConfirm();

    expect(state.requests).toEqual([expect.objectContaining({ action: "delete" })]);
  });
});

describe("pinned thread operation permissions", () => {
  it("checks every materialization target before writing any keys", async () => {
    const moved = makeThread({ pinnedAt: "2026-09-02T00:00:00.000Z" });
    state.shells = [
      moved,
      makeThread({
        id: ThreadId.make("other-thread"),
        environmentId: otherEnvironmentId,
        pinnedAt: "2026-09-02T00:00:00.000Z",
        createdAt: "2026-09-02T00:00:00.000Z",
      }),
    ];

    expect(await useThreadListActions().moveThread(moved, "up")).toBe(false);
    expect(state.requests).toEqual([]);
  });

  it("moves a keyed thread past a read-only neighbor without writing that neighbor", async () => {
    const moved = makeThread({ pinnedAt: "2026-09-02T00:00:00.000Z", pinOrderKey: "m" });
    state.shells = [
      moved,
      makeThread({
        id: ThreadId.make("other-thread"),
        environmentId: otherEnvironmentId,
        pinnedAt: "2026-09-02T00:00:00.000Z",
        pinOrderKey: "g",
      }),
    ];

    expect(await useThreadListActions().moveThread(moved, "up")).toBe(true);
    expect(state.requests).toEqual([
      expect.objectContaining({ action: "reorderPin", environmentId: primaryEnvironmentId }),
    ]);
  });

  it("rechecks permission between materialization writes", async () => {
    const moved = makeThread({ pinnedAt: "2026-09-02T00:00:00.000Z" });
    state.shells = [
      moved,
      makeThread({
        id: ThreadId.make("other-thread"),
        pinnedAt: "2026-09-02T00:00:00.000Z",
        createdAt: "2026-09-02T00:00:00.000Z",
      }),
    ];
    state.afterRequest = () => state.scopes.get(primaryEnvironmentId)!.clear();

    expect(await useThreadListActions().moveThread(moved, "up")).toBe(false);
    expect(state.requests).toHaveLength(1);
  });
});

describe("automation archive confirmation", () => {
  it.each(["ios", "android"])(
    "requires confirmation on %s and preserves cancellation",
    async (os) => {
      vi.stubEnv("EXPO_OS", os);
      state.taskList.mockResolvedValue(
        AsyncResult.success({ tasks: [{ threadId: "thread", title: "Daily brief" }] }),
      );
      const actions = useThreadListActions();
      for (const confirmed of [false, true]) {
        let shown!: () => void;
        const dialogShown = new Promise<void>((resolve) => {
          shown = resolve;
        });
        state.onDialog = shown;
        const archived = actions.archiveThread(makeThread());
        await dialogShown;
        expect(state.requests).toEqual([]);
        if (os === "ios") {
          state.alerts
            .at(-1)!
            .buttons!.find(
              (button) => button.text === (confirmed ? "Archive and pause" : "Cancel"),
            )!.onPress!();
        } else {
          const dialog = state.dialogs.at(-1)!;
          (confirmed ? dialog.onConfirm : dialog.onCancel)();
        }
        expect(await archived).toBe(confirmed);
        expect(state.requests).toHaveLength(confirmed ? 1 : 0);
      }
    },
  );
  it("does not archive if loading automations fails", async () => {
    state.taskList.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Disconnected"))));
    expect(await useThreadListActions().archiveThread(makeThread())).toBe(false);
    expect(state.requests).toEqual([]);
    expect(state.alerts.at(-1)?.title).toBe("Could not archive thread");
  });
});
