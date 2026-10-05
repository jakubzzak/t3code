// @vitest-environment jsdom

import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vite-plus/test";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { usePreviewMiniPlayerStore } from "../previewMiniPlayerStore";
import { ThreadSettledTools } from "./ThreadSettledTools";

const io = vi.hoisted(() => ({ threads: [] as ReadonlyArray<EnvironmentThreadShell> }));
vi.mock("../state/entities", () => ({ useThreadShells: () => io.threads }));
const target = scopeThreadRef(EnvironmentId.make("host"), ThreadId.make("chat"));
const otherChat = scopeThreadRef(target.environmentId, ThreadId.make("other"));
const otherHost = scopeThreadRef(EnvironmentId.make("remote"), target.threadId);
const settledAt = "2026-01-01T00:00:00.000Z";
let root: Root;
let container: HTMLDivElement;

function shell(ref: ScopedThreadRef, stamp: string | null = null) {
  return {
    environmentId: ref.environmentId,
    id: ref.threadId,
    settledAt: stamp,
  } as EnvironmentThreadShell;
}
function openTools(ref: ScopedThreadRef) {
  useRightPanelStore.getState().open(ref, "diff");
  useRightPanelStore.getState().openBrowser(ref, "tab");
  useRightPanelStore.getState().openTerminal(ref, "default");
  useTerminalUiStateStore.getState().ensureTerminal(ref, "default", { open: true });
  usePreviewMiniPlayerStore.getState().open(ref, { kind: "browser", tabId: "tab" });
}
function expectTools(ref: ScopedThreadRef, open: boolean) {
  const key = scopedThreadKey(ref);
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces,
  ).toHaveLength(open ? 3 : 0);
  expect(
    useTerminalUiStateStore.getState().terminalUiStateByThreadKey[key]?.terminalOpen ?? false,
  ).toBe(open);
  expect(usePreviewMiniPlayerStore.getState().byThreadKey[key] !== undefined).toBe(open);
}
async function render(threads: ReadonlyArray<EnvironmentThreadShell>) {
  io.threads = threads;
  await act(async () => root.render(<ThreadSettledTools />));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  useTerminalUiStateStore.setState({
    terminalUiStateByThreadKey: {},
    suppressedTerminalIdsByThreadKey: {},
  });
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("closes tools only for the settled chat and environment without a manual cleanup dialog", async () => {
  for (const ref of [target, otherChat, otherHost]) openTools(ref);
  await render([shell(target), shell(otherChat), shell(otherHost)]);
  expectTools(target, true);
  await render([shell(target, settledAt), shell(otherChat), shell(otherHost)]);
  expectTools(target, false);
  expectTools(otherChat, true);
  expectTools(otherHost, true);
  await render([shell(target), shell(otherChat), shell(otherHost)]);
  expectTools(target, false);
});

it("clears persisted tools on reconnect but lets tools opened after settlement stay open", async () => {
  openTools(target);
  await render([shell(target, settledAt)]);
  expectTools(target, false);
  openTools(target);
  await render([shell(target, settledAt), shell(otherChat)]);
  expectTools(target, true);
  await render([shell(target)]);
  await render([shell(target, "2026-01-02T00:00:00.000Z")]);
  expectTools(target, false);
});
