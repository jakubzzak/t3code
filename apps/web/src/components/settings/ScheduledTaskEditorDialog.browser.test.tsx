import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
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
// Atoms are replaced by string tags; only the providers tag reads data.
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: ((atom: string) => (atom === "providers" ? state.providers : true)) as never,
}));
vi.mock(import("../../state/server"), async (original) => ({
  ...(await original()),
  EMPTY_SERVER_PROVIDERS: [],
  serverEnvironment: {
    providersValueAtom: () => "providers",
    scheduledTasksLive: () => "tasks",
    upsertScheduledTask: { permissionAtom: () => "permission" },
  } as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.upsert) as never,
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  // A null atom is a skipped query, such as the destination's thread family.
  useEnvironmentQuery: ((atom: unknown) => ({
    data: atom === null ? null : { tasks: state.tasks },
  })) as never,
  formatEnvironmentQueryError: (error: unknown) => String(error),
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironment: (() => environment) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => [project]) as never,
  useThreadShell: () => null,
  useVisibleThreadShells: () => [],
}));
vi.mock(import("../../state/managedPolicy"), async (original) => ({
  ...(await original()),
  useManagedPolicy: () => undefined,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../hooks/useProjectGitEnabled"), async (original) => ({
  ...(await original()),
  useProjectGitEnabled: () => false,
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: (() => ({
    ...DEFAULT_SERVER_SETTINGS,
    projectSettingsOverrides: { [projectId]: { providerInstances: { codex: { enabled: false } } } },
  })) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    scope: { kind: "all", environmentIds: [environmentId] },
    connectedEnvironments: [environment],
  })) as never,
}));
vi.mock(import("../EnvironmentMachineIcon"), async (original) => ({
  ...(await original()),
  EnvironmentMachineIcon: (() => null) as never,
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => DEFAULT_SERVER_SETTINGS) as never,
  useUpdateScopedSettings: () => vi.fn(),
}));
vi.mock(import("./ScopedSwitch"), async (original) => ({
  ...(await original()),
  ScopedSwitch: (() => null) as never,
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsPageContainer: "div" as never,
  SettingsRow: "div" as never,
  SettingsSection: "div" as never,
  useRelativeTimeTick: (() => undefined) as never,
}));
vi.mock(import("../WorktreeBaseBranchPicker"), async (original) => ({
  ...(await original()),
  WorktreeBaseBranchPicker: (() => null) as never,
}));
vi.mock(import("../ui/toast"), async (original) => ({
  ...(await original()),
  toastManager: { add: vi.fn() } as never,
  stackedThreadToast: ((value: unknown) => value) as never,
}));
vi.mock(import("../ui/dialog"), async (original) => ({
  ...(await original()),
  Dialog: (({ children }: { children: ReactNode }) => <div>{children}</div>) as never,
  DialogPopup: "div" as never,
  DialogHeader: "div" as never,
  DialogTitle: "h1" as never,
  DialogDescription: "p" as never,
  DialogPanel: "div" as never,
  DialogFooter: "div" as never,
  DialogClose: (({ children }: { children: ReactNode }) => (
    <button onClick={state.close}>{children}</button>
  )) as never,
}));
vi.mock(import("../ui/select"), async (original) => ({
  ...(await original()),
  Select: (({ children }: { children: ReactNode }) => <div>{children}</div>) as never,
  SelectTrigger: "div" as never,
  SelectValue: "span" as never,
  SelectPopup: (() => null) as never,
  SelectItem: "span" as never,
}));
// Keep the editor's state/save path real; the picker boundary emits explicit user selections.
vi.mock(import("../chat/ProviderModelPicker"), async (original) => ({
  ...(await original()),
  ProviderModelPicker: ((props: {
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
  )) as never,
}));

import { render } from "../../../test/render";
import { ScheduledTaskEditorDialog } from "./ScheduledTasksSettings";

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

function setup() {
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
  return render(
    <ScheduledTaskEditorDialog
      initialEnvironmentId={environmentId}
      task={task}
      onClose={state.close}
    />,
  );
}

async function click(screen: Awaited<ReturnType<typeof setup>>, label: string) {
  const button = screen.getByRole("button", { name: label, exact: true });
  await expect.element(button).toBeEnabled();
  await button.click();
}

it("preserves the disabled provider, model and options when saved without a model change", async () => {
  await using screen = await setup();
  await expect
    .element(screen.getByRole("combobox", { name: "Model" }))
    .toHaveValue("codex:saved-model");
  await expect.element(screen.container).toMatchTextContent("Saving keeps this selection");
  await click(screen, "Save task");
  await vi.waitFor(() => expect(state.close).toHaveBeenCalledTimes(1));
  expect(state.tasks[0]?.modelSelection).toEqual(modelSelection);
  expect(state.upsert).toHaveBeenCalledTimes(1);
});

it("changes provider only after an explicit choice and drops the old provider's options", async () => {
  await using screen = await setup();
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Model" }),
    "claudeAgent:replacement",
  );
  await click(screen, "Save task");
  await vi.waitFor(() =>
    expect(state.tasks[0]?.modelSelection).toEqual({
      instanceId: "claudeAgent",
      model: "replacement",
    }),
  );
});

it("does not save a replacement when editing is cancelled", async () => {
  await using screen = await setup();
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Model" }),
    "claudeAgent:replacement",
  );
  await click(screen, "Cancel");
  expect(state.close).toHaveBeenCalledTimes(1);
  expect(state.upsert).not.toHaveBeenCalled();
  expect(state.tasks[0]?.modelSelection).toEqual(modelSelection);
});
