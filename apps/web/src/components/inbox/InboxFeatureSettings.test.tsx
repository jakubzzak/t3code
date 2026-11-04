// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { InboxFeatureSettings, InboxVisibilitySettings } from "./InboxFeatureSettings";

const state = vi.hoisted(() => ({
  update: vi.fn(),
  mixed: false,
  summary: false,
  resolutions: false,
  summaryMixed: false,
  threshold: 98,
  projectId: null as string | null,
  referenceReads: [] as string[],
}));
vi.mock("../settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    environment: state.projectId ? { environmentId: "env" } : null,
    target: state.projectId ? { projectId: state.projectId } : null,
  }),
}));
vi.mock("~/state/inbox", () => ({
  inboxEnvironment: { references: (request: unknown) => request },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (request: { input: { projectId: string; offset: number } } | null) => {
    if (!request) return { data: null, error: null, isPending: false };
    const { projectId, offset } = request.input;
    state.referenceReads.push(`${projectId}:${offset}`);
    const total = projectId === "first" ? 101 : 1;
    return {
      data: Array.from({ length: Math.max(0, Math.min(100, total - offset)) }, (_, index) => ({
        id: `${projectId}:${offset + index}`,
        content: `${projectId} reference ${offset + index + 1}`,
        source: "slack",
        irrelevant: true,
      })),
      error: null,
      isPending: false,
    };
  },
}));
vi.mock("../settings/useScopedSettings", () => ({
  useScopedSettings: () => ({
    ...DEFAULT_SERVER_SETTINGS,
    inboxSummaryEnabled: state.summary,
    inboxPreResolution: state.resolutions,
    inboxIrrelevanceThreshold: state.threshold,
  }),
  useUpdateScopedSettings: () => state.update,
  useScopedSettingsMixed: (keys: string[]) =>
    (state.mixed &&
      keys.some((key) =>
        ["inboxInitialHistoryDays", "inboxRefreshIntervalMinutes"].includes(key),
      )) ||
    (state.summaryMixed && keys.includes("inboxSummaryEnabled")),
}));
vi.mock("../settings/useScopedModelAvailability", () => ({
  useScopedModelDisabledReason: () => () => null,
}));
vi.mock("~/providerInstances", () => ({
  applyProviderInstanceSettings: () => [],
  deriveProviderInstanceEntries: () => [],
  sortProviderInstanceEntries: () => [],
}));
vi.mock("../chat/ProviderModelPicker", () => ({ ProviderModelPicker: () => null }));
vi.mock("../settings/settingsLayout", () => ({
  SETTINGS_PICKER_TRIGGER_CLASSNAME: "",
  SettingsRow: ({
    title,
    children,
    control,
  }: {
    title: ReactNode;
    children?: ReactNode;
    control?: ReactNode;
  }) => (
    <div>
      {title}
      {control}
      {children}
    </div>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  state.mixed = false;
  state.summary = false;
  state.resolutions = false;
  state.summaryMixed = false;
  state.threshold = 98;
  state.projectId = null;
  state.referenceReads = [];
  vi.clearAllMocks();
});

it("keeps suggestions unavailable while summary is off, retaining the saved opt-in on re-enable", async () => {
  state.resolutions = true;
  await act(async () => root.render(<InboxFeatureSettings />));
  const suggestion = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Suggested resolutions"]')!;
  expect(suggestion().getAttribute("aria-disabled")).toBe("true");
  expect(suggestion().getAttribute("aria-checked")).toBe("false");
  await act(async () => suggestion().click());
  expect(state.update).not.toHaveBeenCalled();
  state.summary = true;
  await act(async () => root.render(<InboxFeatureSettings />));
  expect(suggestion().getAttribute("aria-disabled")).not.toBe("true");
  expect(suggestion().getAttribute("aria-checked")).toBe("true");
  await act(async () => suggestion().click());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ inboxPreResolution: false });
});

it("requires summary enabled across every selected project before editing suggestions", async () => {
  state.summary = true;
  state.summaryMixed = true;
  await act(async () => root.render(<InboxFeatureSettings />));
  expect(
    container
      .querySelector<HTMLButtonElement>('[aria-label="Suggested resolutions"]')!
      .getAttribute("aria-disabled"),
  ).toBe("true");
});
const edit = async (value: string, label = "Inbox initial history days") => {
  const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => field.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => field.blur());
  return field;
};
it("commits zero and thirty immediately, and restores the current value after invalid input", async () => {
  await act(async () => root.render(<InboxFeatureSettings />));
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Inbox initial history days"]')!.value,
  ).toBe("7");
  await edit("0");
  expect(state.update).toHaveBeenLastCalledWith({ inboxInitialHistoryDays: 0 });
  await edit("30");
  expect(state.update).toHaveBeenLastCalledWith({ inboxInitialHistoryDays: 30 });
  for (const value of ["31", "-1", "0.5", ""]) expect((await edit(value)).value).toBe("7");
  expect(state.update).toHaveBeenCalledTimes(2);
});
it("allows a shared zero-day selection when selected projects have mixed history values", async () => {
  state.mixed = true;
  await act(async () => root.render(<InboxFeatureSettings />));
  await edit("0");
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ inboxInitialHistoryDays: 0 });
});

it("defaults refresh to two minutes and commits only whole minutes from two to 120", async () => {
  await act(async () => root.render(<InboxFeatureSettings />));
  const label = "Inbox refresh interval minutes";
  expect(container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)?.value).toBe("2");
  await edit("60", label);
  expect(state.update).toHaveBeenLastCalledWith({ inboxRefreshIntervalMinutes: 60 });
  await edit("61", label);
  expect(state.update).toHaveBeenLastCalledWith({ inboxRefreshIntervalMinutes: 61 });
  await edit("120", label);
  expect(state.update).toHaveBeenLastCalledWith({ inboxRefreshIntervalMinutes: 120 });
  await edit("5", label);
  expect(state.update).toHaveBeenLastCalledWith({ inboxRefreshIntervalMinutes: 5 });
  for (const value of ["0", "1", "121", "2.5", ""])
    expect((await edit(value, label)).value).toBe("2");
  expect(state.update).toHaveBeenCalledTimes(4);
});

it("applies the minimum interval to projects with mixed refresh settings", async () => {
  state.mixed = true;
  await act(async () => root.render(<InboxFeatureSettings />));
  await edit("2", "Inbox refresh interval minutes");
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ inboxRefreshIntervalMinutes: 2 });
});

it("keeps confidence and references in settings without duplicate category switches", async () => {
  await act(async () => root.render(<InboxVisibilitySettings />));
  expect(container.textContent).toContain("Inbox relevance");
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect(container.textContent).toContain("Saved references");
  const label = "Irrelevance confidence percentage";
  expect(container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)?.value).toBe("98");
  await edit("75", label);
  expect(state.update).toHaveBeenLastCalledWith({ inboxIrrelevanceThreshold: 75 });
  await edit("100", label);
  expect(state.update).toHaveBeenLastCalledWith({ inboxIrrelevanceThreshold: 100 });
  for (const value of ["74", "101", "98.5", ""])
    expect((await edit(value, label)).value).toBe("98");
  expect(state.update).toHaveBeenCalledTimes(2);
});

it("reviews references after the first hundred and resets paging when the project changes", async () => {
  state.projectId = "first";
  await act(async () => root.render(<InboxVisibilitySettings />));
  expect(state.referenceReads).toEqual([]);
  const openReferences = async () => {
    const details = container.querySelector("details")!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
  };
  await openReferences();
  expect(container.textContent).toContain("first reference 100");
  expect(container.textContent).not.toContain("first reference 101");
  const button = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === label,
    )!;
  await act(async () => button("Next references").click());
  expect(container.textContent).toContain("first reference 101");
  expect(container.textContent).not.toContain("first reference 100");
  expect(button("Next references").disabled).toBe(true);
  await act(async () => button("Previous references").click());
  expect(container.textContent).toContain("first reference 100");
  await act(async () => button("Next references").click());
  state.projectId = "second";
  await act(async () => root.render(<InboxVisibilitySettings />));
  expect(container.querySelector("details")!.open).toBe(false);
  await openReferences();
  expect(container.textContent).toContain("second reference 1");
  expect(container.textContent).not.toContain("first reference");
  expect(state.referenceReads.at(-1)).toBe("second:0");
  expect(state.update).not.toHaveBeenCalled();
});

it("reflects the acknowledged confidence when Tab moves between controls before the save returns", async () => {
  state.threshold = 100;
  await act(async () => root.render(<InboxVisibilitySettings />));
  const number = container.querySelector<HTMLInputElement>(
    '[aria-label="Irrelevance confidence percentage"]',
  )!;
  const slider = container.querySelector<HTMLInputElement>(
    '[aria-label="Minimum irrelevance confidence"]',
  )!;
  await edit("98", "Irrelevance confidence percentage");
  await act(async () => slider.focus());
  expect(state.update).toHaveBeenLastCalledWith({ inboxIrrelevanceThreshold: 98 });
  state.threshold = 98;
  await act(async () => root.render(<InboxVisibilitySettings />));
  expect(number.value).toBe("98");
  expect(slider.value).toBe("98");
  expect(document.activeElement).toBe(slider);
  expect(state.update).toHaveBeenCalledTimes(1);
});
