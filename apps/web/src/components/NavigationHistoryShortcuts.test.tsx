// @vitest-environment jsdom
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";
import { NavigationHistoryShortcuts } from "./NavigationHistoryShortcuts";

const runtime = vi.hoisted(() => ({
  params: {} as Partial<Record<"environmentId" | "threadId" | "draftId", string>>,
  bindings: [] as ResolvedKeybindingsConfig,
  draft: null as { environmentId: EnvironmentId; threadId: ThreadId } | null,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => runtime.bindings }));
vi.mock("../state/server", () => ({ primaryServerKeybindingsAtom: {} }));
vi.mock("@tanstack/react-router", () => ({
  useParams: ({ select }: { select: (params: typeof runtime.params) => unknown }) =>
    select(runtime.params),
}));
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: (
    select: (store: { getDraftSession: () => typeof runtime.draft }) => unknown,
  ) => select({ getDraftSession: () => runtime.draft }),
}));
vi.mock("../terminalUiStateStore", () => ({
  useTerminalUiStateStore: { getState: () => ({ terminalUiStateByThreadKey: {} }) },
  selectThreadTerminalUiState: () => ({ terminalOpen: false }),
}));

const ref = scopeThreadRef(EnvironmentId.make("file-env"), ThreadId.make("file-thread"));
let root: Root;
let mount: HTMLDivElement;
let back: ReturnType<typeof vi.spyOn>;
let forward: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  runtime.params = { environmentId: ref.environmentId, threadId: ref.threadId };
  runtime.bindings = DEFAULT_RESOLVED_KEYBINDINGS;
  runtime.draft = null;
  useRightPanelStore.setState({ byThreadKey: {}, fileNavigationByThreadKey: {} });
  back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderShortcuts() {
  await act(async () => root.render(<NavigationHistoryShortcuts />));
}

async function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  target.focus();
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...options,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

it("navigates file history before a focused shadow editor can indent the file", async () => {
  const store = useRightPanelStore.getState();
  store.open(ref, "files");
  store.openFile(ref, "alpha.txt");
  const host = document.createElement("div");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const editor = document.createElement("textarea");
  editor.value = "Keep this file unchanged";
  shadow.append(editor);
  const indent = vi.fn((event: KeyboardEvent) => event.stopPropagation());
  editor.addEventListener("keydown", indent);
  editor.setSelectionRange(0, 4);
  await renderShortcuts();
  expect((await press(editor, "[")).defaultPrevented).toBe(true);
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("files");
  await press(editor, "]");
  expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, ref)?.id).toBe(
    "file:alpha.txt",
  );
  expect(indent).not.toHaveBeenCalled();
  expect(editor.value).toBe("Keep this file unchanged");
  expect(back).not.toHaveBeenCalled();
  expect(forward).not.toHaveBeenCalled();
});

it("resolves a draft's file panel without leaving its route", async () => {
  runtime.params = { draftId: "draft-file-history" };
  runtime.draft = { environmentId: ref.environmentId, threadId: ref.threadId };
  const store = useRightPanelStore.getState();
  store.open(ref, "files");
  store.openFile(ref, "alpha.txt");
  await renderShortcuts();
  await press(document.body, "[");
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("files");
  expect(back).not.toHaveBeenCalled();
});

it("lets the browser's capture handler own its history chord", async () => {
  useRightPanelStore.getState().openBrowser(ref, "browser-tab");
  const browser = document.createElement("input");
  document.body.append(browser);
  const navigatePage = vi.fn((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  });
  browser.addEventListener("keydown", navigatePage, true);
  await renderShortcuts();
  await press(browser, "[");
  expect(navigatePage).toHaveBeenCalledOnce();
  expect(back).not.toHaveBeenCalled();
});

it("keeps terminal input and keybinding capture available with a file open", async () => {
  useRightPanelStore.getState().openFile(ref, "alpha.txt");
  const terminal = document.createElement("textarea");
  terminal.dataset.terminalOwner = "drawer";
  const binding = document.createElement("input");
  binding.dataset.keybindingCapture = "";
  document.body.append(terminal, binding);
  await renderShortcuts();
  expect((await press(terminal, "[")).defaultPrevented).toBe(false);
  expect((await press(binding, "[")).defaultPrevented).toBe(false);
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("file");
  expect(back).not.toHaveBeenCalled();
});

it("uses route history outside files and does not navigate twice", async () => {
  useRightPanelStore.getState().open(ref, "diff");
  await renderShortcuts();
  await press(document.body, "[");
  await press(document.body, "]");
  expect(back).toHaveBeenCalledOnce();
  expect(forward).toHaveBeenCalledOnce();
});

it("uses configured navigation bindings while an editable field has focus", async () => {
  runtime.bindings = compileResolvedKeybindingsConfig([
    { key: "mod+alt+arrowleft", command: "navigation.back" },
    { key: "mod+alt+arrowright", command: "navigation.forward" },
  ]);
  const store = useRightPanelStore.getState();
  store.openFile(ref, "alpha.txt");
  const editor = document.createElement("textarea");
  document.body.append(editor);
  await renderShortcuts();
  await press(editor, "ArrowLeft", { altKey: true });
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("files");
  await press(editor, "ArrowRight", { altKey: true });
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("file");
  expect(back).not.toHaveBeenCalled();
  expect(forward).not.toHaveBeenCalled();
});

it("keeps repeated boundary chords inside the current thread", async () => {
  useRightPanelStore.getState().openFile(ref, "alpha.txt");
  await renderShortcuts();
  await press(document.body, "[");
  await press(document.body, "[");
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("files");
  await press(document.body, "]");
  await press(document.body, "]");
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("file");
  expect(back).not.toHaveBeenCalled();
  expect(forward).not.toHaveBeenCalled();
});
