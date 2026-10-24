// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { InboxFeatureSettings } from "./InboxFeatureSettings";

const state = vi.hoisted(() => ({
  update: vi.fn(),
  mixed: false,
  summary: false,
  resolutions: false,
  summaryMixed: false,
}));
vi.mock("../settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({ environment: null, target: null }),
}));
vi.mock("../settings/useScopedSettings", () => ({
  useScopedSettings: () => ({
    ...DEFAULT_SERVER_SETTINGS,
    inboxSummaryEnabled: state.summary,
    inboxPreResolution: state.resolutions,
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

it("defaults refresh to two minutes and commits only whole minutes from two to sixty", async () => {
  await act(async () => root.render(<InboxFeatureSettings />));
  const label = "Inbox refresh interval minutes";
  expect(container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)?.value).toBe("2");
  await edit("60", label);
  expect(state.update).toHaveBeenLastCalledWith({ inboxRefreshIntervalMinutes: 60 });
  await edit("5", label);
  expect(state.update).toHaveBeenLastCalledWith({ inboxRefreshIntervalMinutes: 5 });
  for (const value of ["0", "1", "61", "2.5", ""])
    expect((await edit(value, label)).value).toBe("2");
  expect(state.update).toHaveBeenCalledTimes(2);
});

it("applies the minimum interval to projects with mixed refresh settings", async () => {
  state.mixed = true;
  await act(async () => root.render(<InboxFeatureSettings />));
  await edit("2", "Inbox refresh interval minutes");
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ inboxRefreshIntervalMinutes: 2 });
});
