// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ScheduledTaskId,
  type ScheduledTask,
  type ServerProvider,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  upsert: vi.fn(),
  close: vi.fn(),
  providers: [] as ServerProvider[],
  tasks: [] as ScheduledTask[],
}));
const environmentId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "saved-model",
  options: [{ id: "reasoning", value: "high" }],
};
const project = { id: projectId, environmentId, title: "Project", workspaceRoot: "/repo" };
const environment = {
  environmentId,
  label: "Remote",
  connection: { phase: "connected" },
  serverConfig: {
    environment: {
      platform: { machine: "macos" },
      capabilities: { scheduledTaskChatBinding: true },
    },
  },
};
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) => (atom === "providers" ? state.providers : true),
}));
vi.mock("../../state/server", () => ({
  EMPTY_SERVER_PROVIDERS: [],
  serverEnvironment: {
    providersValueAtom: () => "providers",
    scheduledTasksLive: () => "tasks",
    upsertScheduledTask: { permissionAtom: () => "permission" },
  },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.upsert }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: { tasks: state.tasks } }),
}));
vi.mock("../../state/environments", () => ({ useEnvironment: () => environment }));
vi.mock("../../state/entities", () => ({
  useProjects: () => [project],
  useThreadShells: () => [],
}));
vi.mock("../../state/session", () => ({ readEnvironmentScope: () => true }));
vi.mock("../../hooks/useProjectGitEnabled", () => ({ useProjectGitEnabled: () => false }));
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: () => ({
    ...DEFAULT_SERVER_SETTINGS,
    projectSettingsOverrides: { [projectId]: { providerInstances: { codex: { enabled: false } } } },
  }),
}));
vi.mock("../../lib/archivedThreadsState", () => ({
  useArchivedThreadSnapshots: () => ({ snapshots: [] }),
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    scope: { kind: "all", environmentIds: [environmentId] },
    connectedEnvironments: [environment],
  }),
}));
vi.mock("../EnvironmentMachineIcon", () => ({ EnvironmentMachineIcon: () => null }));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: () => DEFAULT_SERVER_SETTINGS,
  useUpdateScopedSettings: () => vi.fn(),
}));
vi.mock("./ScopedSwitch", () => ({ ScopedSwitch: () => null }));
vi.mock("./settingsLayout", () => ({
  SETTINGS_PICKER_TRIGGER_CLASSNAME: "",
  SettingsPageContainer: "div",
  SettingsRow: "div",
  SettingsSection: "div",
  useRelativeTimeTick: () => undefined,
}));
vi.mock("../WorktreeBaseBranchPicker", () => ({ WorktreeBaseBranchPicker: () => null }));
vi.mock("../ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: (value: unknown) => value,
}));
vi.mock("../ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogPopup: "div",
  DialogHeader: "div",
  DialogTitle: "h1",
  DialogDescription: "p",
  DialogPanel: "div",
  DialogFooter: "div",
  DialogClose: ({ children }: { children: ReactNode }) => (
    <button onClick={state.close}>{children}</button>
  ),
}));
vi.mock("../ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: "div",
  SelectValue: "span",
  SelectPopup: () => null,
  SelectItem: "span",
}));
// Keep the editor's state/save path real; the picker boundary emits explicit user selections.
vi.mock("../chat/ProviderModelPicker", () => ({
  ProviderModelPicker: (props: {
    activeInstanceId: string;
    model: string;
    onInstanceModelChange: (instance: string, model: string) => void;
  }) => (
    <select
      aria-label="Model"
      value={`${props.activeInstanceId}:${props.model}`}
      onChange={(event) => {
        const [instance, model] = event.target.value.split(":");
        props.onInstanceModelChange(instance!, model!);
      }}
    >
      <option value="codex:saved-model">Saved Codex model</option>
      <option value="claudeAgent:replacement">Claude replacement</option>
    </select>
  ),
}));

import { ScheduledTaskEditorDialog } from "./ScheduledTasksSettings";

let root: Root;
let container: HTMLDivElement;
const task: ScheduledTask = {
  id: ScheduledTaskId.make("task"),
  title: "Morning brief",
  prompt: "Prepare my brief.",
  enabled: false,
  projectId,
  threadId: null,
  workspaceStrategy: { type: "root" },
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  schedule: { type: "interval", everyMs: 60_000 },
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-10-31T00:00:00.000Z",
  updatedAt: "2026-10-31T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.tasks = [task];
  state.providers = [
    { instanceId: "codex", driver: "codex", displayName: "Joel", model: "saved-model" },
    {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      displayName: "Claude",
      model: "replacement",
    },
  ].map(({ model, ...provider }) => ({
    ...provider,
    instanceId: ProviderInstanceId.make(provider.instanceId),
    driver: ProviderDriverKind.make(provider.driver),
    version: "1.0",
    checkedAt: "2026-10-31T00:00:00.000Z",
    slashCommands: [],
    skills: [],
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: [{ slug: model, name: model, isDefault: true, isCustom: false, capabilities: null }],
  }));
  state.close.mockReset();
  state.upsert
    .mockReset()
    .mockImplementation(async ({ input }: { input: ScheduledTaskUpsertInput }) => {
      state.tasks = [{ ...task, ...input } as ScheduledTask];
      return { _tag: "Success", value: {} };
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <ScheduledTaskEditorDialog
        initialEnvironmentId={environmentId}
        task={task}
        onClose={state.close}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}

it("preserves the disabled provider, model and options when saved without a model change", async () => {
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="Model"]')?.value).toBe(
    "codex:saved-model",
  );
  expect(container.textContent).toContain("Saving keeps this selection");
  await click("Save task");
  expect(state.tasks[0]?.modelSelection).toEqual(modelSelection);
  expect(state.upsert).toHaveBeenCalledTimes(1);
  expect(state.close).toHaveBeenCalledTimes(1);
});

it("changes provider only after an explicit choice and drops the old provider's options", async () => {
  const picker = container.querySelector<HTMLSelectElement>('select[aria-label="Model"]')!;
  await act(async () => {
    picker.value = "claudeAgent:replacement";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("Save task");
  expect(state.tasks[0]?.modelSelection).toEqual({
    instanceId: "claudeAgent",
    model: "replacement",
  });
});

it("does not save a replacement when editing is cancelled", async () => {
  const picker = container.querySelector<HTMLSelectElement>('select[aria-label="Model"]')!;
  await act(async () => {
    picker.value = "claudeAgent:replacement";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("Cancel");
  expect(state.upsert).not.toHaveBeenCalled();
  expect(state.tasks[0]?.modelSelection).toEqual(modelSelection);
});
