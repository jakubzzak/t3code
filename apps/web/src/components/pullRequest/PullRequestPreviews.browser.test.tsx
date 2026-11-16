import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type PullRequestComment,
  type PreviewOpenInput,
} from "@t3tools/contracts";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";

import { act, render, stubGlobal, type Screen } from "../../../test/render";

const { openPreview, closePreview, writeText } = vi.hoisted(() => ({
  openPreview: vi.fn(),
  closePreview: vi.fn(),
  writeText: vi.fn(),
}));
vi.mock(import("~/connection/catalog"), async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const connection = Atom.make(AsyncResult.success({ phase: "connected" }));
  return {
    environmentCatalog: {
      stateAtom: () => connection,
      catalogValueAtom: Atom.make({ isReady: true, entries: new Map() }),
    },
  } as never;
});
vi.mock(import("~/state/preview"), () => ({
  previewEnvironment: { open: openPreview, close: closePreview } as never,
}));
vi.mock(import("~/state/use-atom-command"), () => ({
  useAtomCommand: ((command: unknown) => command) as never,
}));
vi.mock(import("~/hooks/useCopyToClipboard"), async (original) => ({
  ...(await original()),
  writeTextToClipboard: writeText,
}));
// Tooltip popups stay rendered so a test can read collision URLs without hovering.
vi.mock(import("../ui/tooltip"), () => ({
  Tooltip: (({ children }: { children: ReactNode }) => children) as never,
  TooltipTrigger: (({ render, ...props }: { render: ReactElement }) =>
    cloneElement(render, props)) as never,
  TooltipPopup: (({ children }: { children: ReactNode }) => (
    <aside role="tooltip">{children}</aside>
  )) as never,
}));
vi.mock(import("../preview/PreviewPanel"), () => ({
  PreviewPanel: (() => <div>Browser content</div>) as never,
}));
import PullRequestPreviewBrowser from "./PullRequestPreviewBrowser";
import { PullRequestPreviews } from "./PullRequestPreviews";
import { environmentCatalog } from "~/connection/catalog";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { toastManager } from "../ui/toast";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "~/previewStateStore";

const environmentId = EnvironmentId.make("remote");
const threadRef = { environmentId, threadId: ThreadId.make("review-thread") };
const url = "https://prod-2570-one.checkout.staging.jurata.ch";
const other = "https://prod-2570-two.checkout.staging.jurata.ch";
function comments(...urls: string[]): PullRequestComment[] {
  return urls.map((body, index) => ({
    id: String(index),
    kind: "issue-comment",
    body,
    author: null,
    createdAt: "2026-10-15T12:00:00Z",
    url: null,
    path: null,
    reviewState: null,
  }));
}
function previews(values = comments(url), pending = false, error: string | null = null) {
  return (
    <PullRequestPreviews
      environmentId={environmentId}
      threadRef={threadRef}
      comments={values}
      pending={pending}
      error={error}
      truncated={false}
      onRetry={() => {}}
      onOpenStandalone={() => {}}
    />
  );
}
function pills(screen: Screen) {
  return [
    ...screen.container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Open preview"]'),
  ];
}
function tooltips(screen: Screen) {
  return [...screen.container.querySelectorAll('[role="tooltip"]')].map((node) => node.textContent);
}
function rightClick(element: HTMLElement) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}
function browser(target = url) {
  return render(
    <PullRequestPreviewBrowser environmentId={environmentId} url={target} onClose={() => {}} />,
    { router: false },
  );
}

/** Desktop runtime, fresh mocks and a toast spy for one test: `using _setup = setup()`. */
function setup(): Disposable {
  const bridge = stubGlobal("desktopBridge", { preview: {} });
  writeText.mockReset().mockResolvedValue(true);
  closePreview.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  openPreview.mockReset().mockImplementation(async ({ input }: { input: PreviewOpenInput }) =>
    AsyncResult.success({
      threadId: input.threadId,
      tabId: "preview-tab",
      navStatus: { _tag: "Loading", url: input.url, title: "" },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-10-15T12:00:00Z",
    }),
  );
  const toast = vi.spyOn(toastManager, "add");
  resetPreviewStateForTests();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  return {
    [Symbol.dispose]() {
      toast.mockRestore();
      bridge[Symbol.dispose]();
    },
  };
}

it("updates destinations and collision tooltips when refreshed comments change", async () => {
  using _setup = setup();
  await using screen = await render(previews(comments(url, url, other)), { router: false });
  expect(pills(screen)).toHaveLength(2);
  expect(tooltips(screen)).toEqual([url, other]);
  await screen.rerender(previews(comments(other)));
  expect(pills(screen)).toHaveLength(1);
  expect(tooltips(screen)).toHaveLength(0);
  await screen.rerender(previews([]));
  expect(pills(screen)).toHaveLength(0);
  expect(screen.container.textContent).toContain("No previews available");
});

it("distinguishes loading and failure from an empty loaded conversation and recovers", async () => {
  using _setup = setup();
  await using screen = await render(previews([], true), { router: false });
  expect(screen.container.textContent).toContain("Loading previews...");
  expect(screen.container.textContent).not.toContain("No previews available");
  await screen.rerender(previews([], false, "Disconnected"));
  expect(screen.container.textContent).toContain("Could not load previews");
  expect(screen.container.textContent).not.toContain("No previews available");
  await screen.rerender(previews());
  expect(pills(screen)).toHaveLength(1);
});

it("copies the full URL on right click, reports success only after the clipboard write and never opens it", async () => {
  using _setup = setup();
  let finish!: () => void;
  writeText.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      }),
  );
  await using screen = await render(previews(), { router: false });
  const event = await act(() => rightClick(pills(screen)[0]!));
  expect(writeText).toHaveBeenCalledWith(url, "preview URL");
  expect(event.defaultPrevented).toBe(true);
  expect(openPreview).not.toHaveBeenCalled();
  expect(toastManager.add).not.toHaveBeenCalled();
  await act(() => finish());
  expect(toastManager.add).toHaveBeenCalledWith({ type: "success", title: "Preview URL copied" });
  vi.mocked(toastManager.add).mockClear();
  writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
  await act(() => rightClick(pills(screen)[0]!));
  await vi.waitFor(() =>
    expect(toastManager.add).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })),
  );
  expect(toastManager.add).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});

it("opens the full URL in the owning remote thread and reports opening failures", async () => {
  using _setup = setup();
  await using screen = await render(previews(), { router: false });
  await act(() => pills(screen)[0]!.click());
  await vi.waitFor(() =>
    expect(readThreadPreviewState(threadRef).snapshot?.navStatus).toMatchObject({ url }),
  );
  expect(openPreview).toHaveBeenCalledWith(
    expect.objectContaining({
      environmentId,
      input: expect.objectContaining({ threadId: threadRef.threadId, url }),
    }),
  );
  openPreview.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Disconnected"))));
  await act(() => pills(screen)[0]!.click());
  await vi.waitFor(() =>
    expect(toastManager.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", title: "Unable to open preview" }),
    ),
  );
});

it("keeps copying available in a web client without pretending the desktop browser opened", async () => {
  using _setup = setup();
  using _web = stubGlobal("desktopBridge", undefined);
  await using screen = await render(previews(), { router: false });
  await act(() => pills(screen)[0]!.click());
  expect(openPreview).not.toHaveBeenCalled();
  expect(toastManager.add).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "error",
      title: "Preview is only available in the Blackbird desktop app.",
    }),
  );
  await act(() => rightClick(pills(screen)[0]!));
  expect(writeText).toHaveBeenCalledWith(url, "preview URL");
});

it("owns and closes an isolated standalone browser session in the PR environment", async () => {
  using _setup = setup();
  await using screen = await browser();
  const request = openPreview.mock.calls[0]![0] as {
    environmentId: EnvironmentId;
    input: PreviewOpenInput;
  };
  expect(request.environmentId).toBe(environmentId);
  expect(request.input.threadId).not.toBe(threadRef.threadId);
  expect(request.input.url).toBe(url);
  const owner = { environmentId, threadId: request.input.threadId };
  await vi.waitFor(() =>
    expect(readThreadPreviewState(owner).snapshot?.navStatus).toMatchObject({ url }),
  );
  expect(readThreadPreviewState(threadRef).snapshot).toBeNull();
  await screen.unmount();
  expect(closePreview).toHaveBeenCalledWith({
    environmentId,
    input: { threadId: owner.threadId, tabId: "preview-tab" },
  });
  await vi.waitFor(() => expect(readThreadPreviewState(owner).snapshot).toBeNull());
});

it("closes a standalone session that finishes opening after its view was dismissed", async () => {
  using _setup = setup();
  let finish!: () => void;
  openPreview.mockImplementationOnce(
    ({ input }: { input: PreviewOpenInput }) =>
      new Promise((resolve) => {
        finish = () =>
          resolve(
            AsyncResult.success({
              threadId: input.threadId,
              tabId: "late-tab",
              navStatus: { _tag: "Loading", url, title: "" },
              canGoBack: false,
              canGoForward: false,
              updatedAt: "2026-10-15T12:00:00Z",
            }),
          );
      }),
  );
  await using screen = await browser();
  const request = openPreview.mock.calls[0]![0] as { input: PreviewOpenInput };
  await screen.unmount();
  await act(() => finish());
  await vi.waitFor(() =>
    expect(closePreview).toHaveBeenCalledWith({
      environmentId,
      input: { threadId: request.input.threadId, tabId: "late-tab" },
    }),
  );
  expect(
    readThreadPreviewState({ environmentId, threadId: request.input.threadId }).snapshot,
  ).toBeNull();
});

function reconnect() {
  // The mocked atom only needs the phase consumed by cleanup.
  const atom = environmentCatalog.stateAtom(environmentId);
  const set = appAtomRegistry.set.bind(appAtomRegistry) as (atom: unknown, value: unknown) => void;
  set(atom, AsyncResult.success({ phase: "disconnected" }));
  set(atom, AsyncResult.success({ phase: "connected" }));
}

it("keeps failed cleanup suppressed after unmount and retries on reconnect", async () => {
  using _setup = setup();
  closePreview.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Disconnected"))));
  await using first = await browser();
  const owner = { environmentId, threadId: openPreview.mock.calls[0]![0].input.threadId };
  await vi.waitFor(() => expect(readThreadPreviewState(owner).snapshot).not.toBeNull());
  const staleSnapshot = readThreadPreviewState(owner).snapshot;
  await first.unmount();
  await vi.waitFor(() =>
    expect(toastManager.add).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preview cleanup pending" }),
    ),
  );
  applyPreviewServerSnapshot(owner, staleSnapshot);
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
  expect(readThreadPreviewState(owner).suppressedTabIds.has("preview-tab")).toBe(true);
  await using _second = await browser(other);
  const reopenedOwner = { environmentId, threadId: openPreview.mock.calls[1]![0].input.threadId };
  expect(reopenedOwner.threadId).not.toBe(owner.threadId);
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
  await act(() => reconnect());
  await vi.waitFor(() => expect(closePreview).toHaveBeenCalledTimes(2));
  expect(readThreadPreviewState(reopenedOwner).snapshot?.navStatus).toMatchObject({ url: other });
  await act(() => reconnect());
  expect(closePreview).toHaveBeenCalledTimes(2);
});

it("retries a late-open cleanup when reconnect happens during the failed close", async () => {
  using _setup = setup();
  const makeSnapshot = openPreview.getMockImplementation()!;
  let finishOpen!: () => void;
  openPreview.mockImplementationOnce(
    (request) =>
      new Promise((resolve) => {
        finishOpen = () => resolve(makeSnapshot(request));
      }),
  );
  let failClose!: () => void;
  closePreview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        failClose = () => resolve(AsyncResult.failure(Cause.fail(new Error("Disconnected"))));
      }),
  );
  await using screen = await browser();
  const owner = { environmentId, threadId: openPreview.mock.calls[0]![0].input.threadId };
  await screen.unmount();
  await act(() => finishOpen());
  await vi.waitFor(() => expect(closePreview).toHaveBeenCalledTimes(1));
  await act(() => reconnect());
  expect(closePreview).toHaveBeenCalledTimes(1);
  await act(() => failClose());
  await vi.waitFor(() => expect(closePreview).toHaveBeenCalledTimes(2));
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
  await act(() => reconnect());
  expect(closePreview).toHaveBeenCalledTimes(2);
});

it("offers manual retry after a rejected close without restoring the abandoned session", async () => {
  using _setup = setup();
  closePreview.mockRejectedValueOnce(new Error("Lost response"));
  await using screen = await browser();
  const owner = { environmentId, threadId: openPreview.mock.calls[0]![0].input.threadId };
  await screen.unmount();
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
  const notification = await vi.waitFor(
    () =>
      vi
        .mocked(toastManager.add)
        .mock.calls.find(([value]) => value.title === "Preview cleanup pending")![0],
  );
  await act(() => notification.actionProps!.onClick!({} as never));
  await vi.waitFor(() => expect(closePreview).toHaveBeenCalledTimes(2));
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
});
