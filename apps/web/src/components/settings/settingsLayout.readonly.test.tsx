// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { SettingsRow } from "./settingsLayout";
import { Switch } from "../ui/switch";

const state = vi.hoisted(() => ({ value: false, update: vi.fn() }));
vi.mock("./SettingsScopeContext", () => ({
  useOptionalSettingsScope: () => ({
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
  }),
}));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => "env",
  usePrimaryEnvironment: () => ({ label: "Test environment" }),
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: () => new Set(["env"]),
}));
vi.mock("../../hooks/useSettings", () => ({ usePrimarySettingsAvailable: () => true }));
vi.mock("./useScopedSettings", () => ({
  useClearProjectOverrides: () => vi.fn(),
  useClearScopedSettings: () => vi.fn(),
}));
vi.mock("./SettingInheritance", () => ({ SettingInheritance: () => null }));
vi.mock("./SettingsScopeSentence", () => ({ SettingsScopeSentence: () => null }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useLocation: ({ select }: { select: (location: { hash: string; state: object }) => unknown }) =>
    select({ hash: "", state: {} }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
  state.value = false;
});
it("exposes the inherited switch value and edit scope while keyboard focus cannot change it", async () => {
  const render = () =>
    root.render(
      <SettingsRow
        title="Show conversations where the last reply is mine"
        serverScoped
        settingKeys={["inboxShowSelfReplies"]}
        control={
          <Switch
            aria-label="Show conversations where the last reply is mine"
            checked={state.value}
            onCheckedChange={state.update}
          />
        }
      />,
    );
  await act(async () => render());
  const target = container.querySelector<HTMLElement>(
    '[data-slot="tooltip-trigger"][tabindex="0"]',
  )!;
  await act(async () => target.focus());
  expect(document.activeElement).toBe(target);
  expect(target.getAttribute("role")).toBe("switch");
  expect(target.getAttribute("aria-label")).toBe("Show conversations where the last reply is mine");
  expect(target.getAttribute("aria-checked")).toBe("false");
  expect(target.getAttribute("aria-readonly")).toBe("true");
  const description = () => document.getElementById(target.getAttribute("aria-describedby")!);
  expect(description()?.textContent).toContain("All projects");
  await act(async () =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
  );
  expect(state.update).not.toHaveBeenCalled();
  state.value = true;
  await act(async () => render());
  expect(document.activeElement).toBe(target);
  expect(target.getAttribute("aria-checked")).toBe("true");
});

it("preserves positive filter semantics for a read-only inverse setting", async () => {
  const render = () =>
    root.render(
      <SettingsRow
        title="Filter my replies"
        serverScoped
        settingKeys={["inboxShowSelfReplies"]}
        inheritedChecked={!state.value}
        control={
          <Switch
            aria-label="Filter my replies"
            checked={!state.value}
            onCheckedChange={state.update}
          />
        }
      />,
    );
  await act(async () => render());
  const target = container.querySelector<HTMLElement>(
    '[data-slot="tooltip-trigger"][tabindex="0"]',
  )!;
  await act(async () => target.focus());
  expect(target.getAttribute("aria-checked")).toBe("true");
  expect(target.getAttribute("aria-readonly")).toBe("true");
  await act(async () =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
  );
  expect(state.update).not.toHaveBeenCalled();
  state.value = true;
  await act(async () => render());
  expect(document.activeElement).toBe(target);
  expect(target.getAttribute("aria-checked")).toBe("false");
});
