import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type PullRequestComment,
  type PreviewOpenInput,
} from "@t3tools/contracts";
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const { openPreview, closePreview } = vi.hoisted(() => ({
  openPreview: vi.fn(),
  closePreview: vi.fn(),
}));
vi.mock("~/connection/catalog", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const connection = Atom.make(AsyncResult.success({ phase: "connected" }));
  return {
    environmentCatalog: {
      stateAtom: () => connection,
      catalogValueAtom: Atom.make({ isReady: true, entries: new Map() }),
    },
  };
});
vi.mock("~/state/preview", () => ({
  previewEnvironment: { open: openPreview, close: closePreview },
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, ...props }: { render: ReactElement }) => cloneElement(render, props),
  TooltipPopup: ({ children }: { children: ReactNode }) => <aside role="tooltip">{children}</aside>,
}));

vi.mock("../preview/PreviewPanel", () => ({ PreviewPanel: () => <div>Browser content</div> }));
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
let renderer: ReactTestRenderer;
const writeText = vi.fn();
function render(values = comments(url), pending = false, error: string | null = null) {
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
function pills() {
  return renderer.root
    .findAllByType("button")
    .filter((b) => b.props["aria-label"]?.startsWith("Open preview"));
}
function visibleText() {
  return renderer.root
    .findAllByType("span")
    .flatMap((s) => s.children.filter((c) => typeof c === "string"));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("window", { desktopBridge: { preview: {} } });
  writeText.mockReset().mockResolvedValue(undefined);
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
  vi.spyOn(toastManager, "add");
  resetPreviewStateForTests();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("updates destinations and collision tooltips when refreshed comments change", () => {
  act(() => {
    renderer = create(render(comments(url, url, other)));
  });
  expect(pills()).toHaveLength(2);
  expect(renderer.root.findAllByProps({ role: "tooltip" }).map((p) => p.children.join(""))).toEqual(
    [url, other],
  );
  act(() => renderer.update(render(comments(other))));
  expect(pills()).toHaveLength(1);
  expect(renderer.root.findAllByProps({ role: "tooltip" })).toHaveLength(0);
  act(() => renderer.update(render([])));
  expect(pills()).toHaveLength(0);
  expect(visibleText()).toContain("No previews available");
});

it("distinguishes loading and failure from an empty loaded conversation and recovers", () => {
  act(() => {
    renderer = create(render([], true));
  });
  expect(visibleText()).toContain("Loading previews...");
  expect(visibleText()).not.toContain("No previews available");
  act(() => renderer.update(render([], false, "Disconnected")));
  expect(visibleText()).toContain("Could not load previews");
  expect(visibleText()).not.toContain("No previews available");
  act(() => renderer.update(render()));
  expect(pills()).toHaveLength(1);
});

it("copies the full URL on right click, reports success only after the clipboard write and never opens it", async () => {
  let finish!: () => void;
  writeText.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    renderer = create(render());
  });
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  await act(async () => pills()[0]!.props.onContextMenu(event));
  expect(writeText).toHaveBeenCalledWith(url);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(openPreview).not.toHaveBeenCalled();
  expect(toastManager.add).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(toastManager.add).toHaveBeenCalledWith({ type: "success", title: "Preview URL copied" });
  vi.mocked(toastManager.add).mockClear();
  writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
  await act(async () => pills()[0]!.props.onContextMenu(event));
  expect(toastManager.add).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  expect(toastManager.add).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});

it("opens the full URL in the owning remote thread and reports opening failures", async () => {
  act(() => {
    renderer = create(render());
  });
  await act(async () => pills()[0]!.props.onClick());
  expect(openPreview).toHaveBeenCalledWith(
    expect.objectContaining({
      environmentId,
      input: expect.objectContaining({ threadId: threadRef.threadId, url }),
    }),
  );
  expect(readThreadPreviewState(threadRef).snapshot?.navStatus).toMatchObject({ url });
  openPreview.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Disconnected"))));
  await act(async () => pills()[0]!.props.onClick());
  expect(toastManager.add).toHaveBeenCalledWith(
    expect.objectContaining({ type: "error", title: "Unable to open preview" }),
  );
});

it("keeps copying available in a web client without pretending the desktop browser opened", async () => {
  vi.stubGlobal("window", {});
  act(() => {
    renderer = create(render());
  });
  await act(async () => pills()[0]!.props.onClick());
  expect(openPreview).not.toHaveBeenCalled();
  expect(toastManager.add).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "error",
      title: "Preview is only available in the Blackbird desktop app.",
    }),
  );
  await act(async () =>
    pills()[0]!.props.onContextMenu({ preventDefault() {}, stopPropagation() {} }),
  );
  expect(writeText).toHaveBeenCalledWith(url);
});

it("owns and closes an isolated standalone browser session in the PR environment", async () => {
  await act(async () => {
    renderer = create(
      <PullRequestPreviewBrowser environmentId={environmentId} url={url} onClose={() => {}} />,
    );
  });
  const request = openPreview.mock.calls[0]![0] as {
    environmentId: EnvironmentId;
    input: PreviewOpenInput;
  };
  expect(request.environmentId).toBe(environmentId);
  expect(request.input.threadId).not.toBe(threadRef.threadId);
  expect(request.input.url).toBe(url);
  const owner = { environmentId, threadId: request.input.threadId };
  expect(readThreadPreviewState(owner).snapshot?.navStatus).toMatchObject({ url });
  expect(readThreadPreviewState(threadRef).snapshot).toBeNull();
  await act(async () => renderer.unmount());
  expect(closePreview).toHaveBeenCalledWith({
    environmentId,
    input: { threadId: owner.threadId, tabId: "preview-tab" },
  });
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
});

it("closes a standalone session that finishes opening after its view was dismissed", async () => {
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
  await act(async () => {
    renderer = create(
      <PullRequestPreviewBrowser environmentId={environmentId} url={url} onClose={() => {}} />,
    );
  });
  const request = openPreview.mock.calls[0]![0] as { input: PreviewOpenInput };
  await act(async () => renderer.unmount());
  await act(async () => finish());
  expect(closePreview).toHaveBeenCalledWith({
    environmentId,
    input: { threadId: request.input.threadId, tabId: "late-tab" },
  });
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
  closePreview.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Disconnected"))));
  await act(async () => {
    renderer = create(
      <PullRequestPreviewBrowser environmentId={environmentId} url={url} onClose={() => {}} />,
    );
  });
  const owner = { environmentId, threadId: openPreview.mock.calls[0]![0].input.threadId };
  const staleSnapshot = readThreadPreviewState(owner).snapshot;
  await act(async () => renderer.unmount());
  applyPreviewServerSnapshot(owner, staleSnapshot);
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
  expect(readThreadPreviewState(owner).suppressedTabIds.has("preview-tab")).toBe(true);
  expect(toastManager.add).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Preview cleanup pending" }),
  );
  await act(async () => {
    renderer = create(
      <PullRequestPreviewBrowser environmentId={environmentId} url={other} onClose={() => {}} />,
    );
  });
  const reopenedOwner = { environmentId, threadId: openPreview.mock.calls[1]![0].input.threadId };
  expect(reopenedOwner.threadId).not.toBe(owner.threadId);
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
  await act(async () => reconnect());
  expect(closePreview).toHaveBeenCalledTimes(2);
  expect(readThreadPreviewState(reopenedOwner).snapshot?.navStatus).toMatchObject({ url: other });
  await act(async () => reconnect());
  expect(closePreview).toHaveBeenCalledTimes(2);
});

it("retries a late-open cleanup when reconnect happens during the failed close", async () => {
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
  await act(async () => {
    renderer = create(
      <PullRequestPreviewBrowser environmentId={environmentId} url={url} onClose={() => {}} />,
    );
  });
  const owner = { environmentId, threadId: openPreview.mock.calls[0]![0].input.threadId };
  await act(async () => renderer.unmount());
  await act(async () => finishOpen());
  await act(async () => reconnect());
  expect(closePreview).toHaveBeenCalledTimes(1);
  await act(async () => failClose());
  expect(closePreview).toHaveBeenCalledTimes(2);
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
  await act(async () => reconnect());
  expect(closePreview).toHaveBeenCalledTimes(2);
});

it("offers manual retry after a rejected close without restoring the abandoned session", async () => {
  closePreview.mockRejectedValueOnce(new Error("Lost response"));
  await act(async () => {
    renderer = create(
      <PullRequestPreviewBrowser environmentId={environmentId} url={url} onClose={() => {}} />,
    );
  });
  const owner = { environmentId, threadId: openPreview.mock.calls[0]![0].input.threadId };
  await act(async () => renderer.unmount());
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
  const notification = vi
    .mocked(toastManager.add)
    .mock.calls.find(([value]) => value.title === "Preview cleanup pending")![0];
  await act(async () => notification.actionProps!.onClick!({} as never));
  expect(closePreview).toHaveBeenCalledTimes(2);
  expect(readThreadPreviewState(owner).snapshot).toBeNull();
});
