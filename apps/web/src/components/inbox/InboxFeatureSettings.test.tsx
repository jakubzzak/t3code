// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { InboxFeatureSettings } from "./InboxFeatureSettings";

const state = vi.hoisted(() => ({ update: vi.fn(), mixed: false }));
vi.mock("../settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({ environment: null, target: null }),
}));
vi.mock("../settings/useScopedSettings", () => ({
  useScopedSettings: () => DEFAULT_SERVER_SETTINGS,
  useUpdateScopedSettings: () => state.update,
  useScopedSettingsMixed: (keys: string[]) =>
    state.mixed && keys.includes("inboxInitialHistoryDays"),
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
  vi.clearAllMocks();
});
const edit = async (value: string) => {
  const field = container.querySelector<HTMLInputElement>(
    '[aria-label="Inbox initial history days"]',
  )!;
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
