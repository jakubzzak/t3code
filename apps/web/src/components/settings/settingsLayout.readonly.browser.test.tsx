import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";

const state = vi.hoisted(() => ({ value: false }));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useOptionalSettingsScope: (() => ({
    scope: { kind: "project", environmentIds: ["env"] },
    connectedEnvironments: [{ environmentId: "env", serverConfig: { settings: {} } }],
    targets: [
      {
        environmentId: "env",
        settings: { ...DEFAULT_SERVER_SETTINGS, inboxShowSelfReplies: state.value },
      },
    ],
    environments: [{ environmentId: "env", label: "Test environment" }],
    groups: [],
    search: {},
  })) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => "env") as never,
  usePrimaryEnvironment: (() => ({ label: "Test environment" })) as never,
}));
// The connection may change settings, so the row is inert only because the value is inherited.
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: (() => new Set(["env"])) as never,
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  usePrimarySettingsAvailable: () => true,
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useClearProjectOverrides: (() => () => undefined) as never,
  useClearScopedSettings: (() => () => undefined) as never,
}));
vi.mock(import("./SettingInheritance"), async (original) => ({
  ...(await original()),
  SettingInheritance: () => null,
}));
vi.mock(import("./SettingsScopeSentence"), async (original) => ({
  ...(await original()),
  SettingsScopeSentence: () => null,
}));

function setup() {
  state.value = false;
  return { update: vi.fn<(checked: boolean) => void>() };
}

function readOnlyTarget(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-slot="tooltip-trigger"][tabindex="0"]')!;
}

it("exposes the inherited switch value and edit scope while keyboard focus cannot change it", async () => {
  const { update } = setup();
  const row = () => (
    <SettingsRow
      title="Show conversations where the last reply is mine"
      serverScoped
      settingKeys={["inboxShowSelfReplies"]}
      control={
        <Switch
          aria-label="Show conversations where the last reply is mine"
          checked={state.value}
          onCheckedChange={update}
        />
      }
    />
  );
  await using screen = await render(row());
  const target = readOnlyTarget(screen.container);
  target.focus();
  await expect.element(target).toHaveFocus();
  expect(target.getAttribute("role")).toBe("switch");
  expect(target.getAttribute("aria-label")).toBe("Show conversations where the last reply is mine");
  expect(target.getAttribute("aria-checked")).toBe("false");
  expect(target.getAttribute("aria-readonly")).toBe("true");
  const description = () => document.getElementById(target.getAttribute("aria-describedby")!);
  expect(description()?.textContent).toContain("All projects");

  await userEvent.keyboard(" ");
  expect(update).not.toHaveBeenCalled();

  state.value = true;
  await screen.rerender(row());
  expect(document.activeElement).toBe(target);
  expect(target.getAttribute("aria-checked")).toBe("true");
});

it("preserves positive filter semantics for a read-only inverse setting", async () => {
  const { update } = setup();
  const row = () => (
    <SettingsRow
      title="Filter my replies"
      serverScoped
      settingKeys={["inboxShowSelfReplies"]}
      inheritedChecked={!state.value}
      control={
        <Switch aria-label="Filter my replies" checked={!state.value} onCheckedChange={update} />
      }
    />
  );
  await using screen = await render(row());
  const target = readOnlyTarget(screen.container);
  target.focus();
  await expect.element(target).toHaveFocus();
  expect(target.getAttribute("aria-checked")).toBe("true");
  expect(target.getAttribute("aria-readonly")).toBe("true");

  await userEvent.keyboard(" ");
  expect(update).not.toHaveBeenCalled();

  state.value = true;
  await screen.rerender(row());
  expect(document.activeElement).toBe(target);
  expect(target.getAttribute("aria-checked")).toBe("false");
});
