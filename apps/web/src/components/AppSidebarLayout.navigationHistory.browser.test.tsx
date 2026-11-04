import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";
import type { AnyRouter } from "@tanstack/react-router";
import type { Atom } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { DEFAULT_RESOLVED_KEYBINDINGS: defaults } = await import("@t3tools/shared/keybindings");
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(defaults) };
});

import { useComposerDraftStore } from "../composerDraftStore";
import {
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerKeybindingsAtom } from "../state/server";
import { registerNavigationHistoryCommands } from "./AppSidebarLayout";

const ref = scopeThreadRef(EnvironmentId.make("file-env"), ThreadId.make("file-thread"));
const keybindingsAtom = primaryServerKeybindingsAtom as Atom.Writable<ResolvedKeybindingsConfig>;
let params: Partial<Record<"environmentId" | "threadId" | "draftId", string>>;
let disposeCommands: () => void;
let back: ReturnType<typeof vi.spyOn>;
let forward: ReturnType<typeof vi.spyOn>;

// Only route params and the pathname are read, at event time.
const router = {
  get state() {
    return { matches: [{ params }], location: { pathname: "/" } };
  },
} as unknown as AnyRouter;

beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  params = { environmentId: ref.environmentId, threadId: ref.threadId };
  appAtomRegistry.set(keybindingsAtom, DEFAULT_RESOLVED_KEYBINDINGS);
  useRightPanelStore.setState({ byThreadKey: {}, fileNavigationByThreadKey: {} });
  back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
  disposeCommands = registerNavigationHistoryCommands(router);
});

afterEach(() => {
  disposeCommands();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  target.focus();
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

it("navigates file history before a focused shadow editor can indent the file", () => {
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
  expect(press(editor, "[").defaultPrevented).toBe(true);
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("files");
  press(editor, "]");
  expect(
    selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, ref),
  ).toMatchObject({ kind: "file", relativePath: "alpha.txt" });
  expect(indent).not.toHaveBeenCalled();
  expect(editor.value).toBe("Keep this file unchanged");
  expect(back).not.toHaveBeenCalled();
  expect(forward).not.toHaveBeenCalled();
});

it("resolves a draft's file panel without leaving its route", () => {
  params = { draftId: "draft-file-history" };
  const draftStore = useComposerDraftStore.getState();
  vi.spyOn(useComposerDraftStore, "getState").mockReturnValue({
    ...draftStore,
    getDraftSession: () =>
      ({ environmentId: ref.environmentId, threadId: ref.threadId, promotedTo: null }) as never,
  });
  const store = useRightPanelStore.getState();
  store.open(ref, "files");
  store.openFile(ref, "alpha.txt");
  press(document.body, "[");
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("files");
  expect(back).not.toHaveBeenCalled();
});

it("lets the browser's capture handler own its history chord", () => {
  useRightPanelStore.getState().openBrowser(ref, "browser-tab");
  const browser = document.createElement("input");
  document.body.append(browser);
  const navigatePage = vi.fn((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  });
  browser.addEventListener("keydown", navigatePage, true);
  press(browser, "[");
  expect(navigatePage).toHaveBeenCalledOnce();
  expect(back).not.toHaveBeenCalled();
});

it("keeps terminal input and keybinding capture available with a file open", () => {
  useRightPanelStore.getState().openFile(ref, "alpha.txt");
  const terminal = document.createElement("textarea");
  terminal.dataset.terminalOwner = "drawer";
  const binding = document.createElement("input");
  binding.dataset.keybindingCapture = "";
  document.body.append(terminal, binding);
  expect(press(terminal, "[").defaultPrevented).toBe(false);
  expect(press(binding, "[").defaultPrevented).toBe(false);
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("file");
  expect(back).not.toHaveBeenCalled();
});

it("uses route history outside files and does not navigate twice", () => {
  useRightPanelStore.getState().open(ref, "diff");
  press(document.body, "[");
  press(document.body, "]");
  expect(back).toHaveBeenCalledOnce();
  expect(forward).toHaveBeenCalledOnce();
});

it("uses configured navigation bindings while an editable field has focus", () => {
  appAtomRegistry.set(
    keybindingsAtom,
    compileResolvedKeybindingsConfig([
      { key: "mod+alt+arrowleft", command: "navigation.back" },
      { key: "mod+alt+arrowright", command: "navigation.forward" },
    ]),
  );
  useRightPanelStore.getState().openFile(ref, "alpha.txt");
  const editor = document.createElement("textarea");
  document.body.append(editor);
  press(editor, "ArrowLeft", { altKey: true });
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("files");
  press(editor, "ArrowRight", { altKey: true });
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("file");
  expect(back).not.toHaveBeenCalled();
  expect(forward).not.toHaveBeenCalled();
});

it("keeps repeated boundary chords inside the current thread", () => {
  useRightPanelStore.getState().openFile(ref, "alpha.txt");
  press(document.body, "[");
  press(document.body, "[");
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("files");
  press(document.body, "]");
  press(document.body, "]");
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("file");
  expect(back).not.toHaveBeenCalled();
  expect(forward).not.toHaveBeenCalled();
});
