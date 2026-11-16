import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { usePreviewMiniPlayerStore } from "../previewMiniPlayerStore";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { ThreadSettledTools } from "./ThreadSettledTools";

const io = vi.hoisted(() => ({ threads: [] as ReadonlyArray<EnvironmentThreadShell> }));
vi.mock("../state/entities", () => ({ useThreadShells: () => io.threads }));

const target = scopeThreadRef(EnvironmentId.make("host"), ThreadId.make("chat"));
const otherChat = scopeThreadRef(target.environmentId, ThreadId.make("other"));
const otherHost = scopeThreadRef(EnvironmentId.make("remote"), target.threadId);
const settledAt = "2026-01-01T00:00:00.000Z";

function setup() {
  io.threads = [];
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  useTerminalUiStateStore.setState({
    terminalUiStateByThreadKey: {},
    suppressedTerminalIdsByThreadKey: {},
  });
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
}

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

// The server's thread shells drive the component; each call publishes a new list.
async function renderThreads(threads: ReadonlyArray<EnvironmentThreadShell>) {
  io.threads = threads;
  const screen = await render(<ThreadSettledTools />);
  return Object.assign(screen, {
    publish: (next: ReadonlyArray<EnvironmentThreadShell>) => {
      io.threads = next;
      return screen.rerender(<ThreadSettledTools />);
    },
  });
}

it("closes tools only for the settled chat and environment without a manual cleanup dialog", async () => {
  setup();
  for (const ref of [target, otherChat, otherHost]) openTools(ref);
  await using screen = await renderThreads([shell(target), shell(otherChat), shell(otherHost)]);
  expectTools(target, true);
  await screen.publish([shell(target, settledAt), shell(otherChat), shell(otherHost)]);
  expectTools(target, false);
  expectTools(otherChat, true);
  expectTools(otherHost, true);
  await screen.publish([shell(target), shell(otherChat), shell(otherHost)]);
  expectTools(target, false);
});

it("clears persisted tools on reconnect but lets tools opened after settlement stay open", async () => {
  setup();
  openTools(target);
  await using screen = await renderThreads([shell(target, settledAt)]);
  expectTools(target, false);
  openTools(target);
  await screen.publish([shell(target, settledAt), shell(otherChat)]);
  expectTools(target, true);
  await screen.publish([shell(target)]);
  await screen.publish([shell(target, "2026-01-02T00:00:00.000Z")]);
  expectTools(target, false);
});
