import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  type PullRequestDetailView,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({
  turn: 0 as number | null,
  detail: null as unknown as PullRequestDetailView,
}));

vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock(import("~/state/pullRequests"), async (original) => ({
  ...(await original()),
  usePullRequestTurnRefresh: () => state.turn,
}));
vi.mock(import("./usePullRequestDetail"), async (original) => ({
  ...(await original()),
  usePullRequestDetail: (() => ({
    canWriteSourceControl: true,
    detailQuery: { isPending: false, refresh: vi.fn() },
    activityQuery: { isPending: false, refresh: vi.fn(), error: null },
    activity: null,
    sharedSummary: state.detail,
    coreDetail: state.detail,
    detail: state.detail,
  })) as never,
}));
vi.mock(import("~/state/usePullRequestStack"), async (original) => ({
  ...(await original()),
  usePullRequestStack: (() => ({
    data: null,
    isFresh: true,
    isPending: false,
    error: null,
    refresh: vi.fn(),
  })) as never,
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => vi.fn()) as never,
}));
// The code tab reloads its diff when a token changes; expose the tokens it receives.
vi.mock(import("./PullRequestCodeTab"), () => ({
  default: (({
    refreshToken,
    backgroundRefreshToken,
  }: {
    readonly refreshToken: number;
    readonly backgroundRefreshToken: number;
  }) => (
    <div
      data-testid="code-tab"
      data-refresh-token={refreshToken}
      data-background-refresh-token={backgroundRefreshToken}
    />
  )) as never,
}));

import { PullRequestDetailPanel } from "./PullRequestDetailPanel";

const detail: PullRequestDetailView = {
  provider: SourceControlProviderKind.make("github"),
  projectId: ProjectId.make("project"),
  projectTitle: "Project",
  workspaceRoot: "/workspace",
  repository: "owner/repo",
  number: 1,
  title: "Test pull request",
  body: "Original description",
  url: "https://github.com/owner/repo/pull/1",
  author: { login: "author", name: null, avatarUrl: null },
  viewer: "author",
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  headBranch: "feature",
  baseBranch: "main",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [],
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreads: [],
  commits: [],
  mergeCapabilities: { merge: false, squash: false, rebase: false },
  capabilities: {
    diff: true,
    comment: false,
    search: true,
    actions: [],
    mergeMethods: [],
    review: { inlineComment: false, reply: false, resolve: false, verdicts: [] },
    reviewers: { request: false, listCandidates: false },
    edit: { changeRequest: true, comment: false },
  },
  viewerPermissions: {
    actions: [],
    comment: false,
    resolve: false,
    verdicts: [],
    requestReviewers: false,
  },
};

const environmentId = EnvironmentId.make("environment");
const panel = (chatWorking: boolean) => (
  <PullRequestDetailPanel
    environmentId={environmentId}
    reference={detail}
    initialTab="code"
    deferAutomaticRefresh={chatWorking}
    shortcutsEnabled={false}
    getShortcutContext={() => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
    })}
  />
);

function setup() {
  state.turn = 0;
  state.detail = detail;
}

describe("automatic code refresh beside a working chat", () => {
  it("coalesces turn notifications until work stops, with manual refresh still available", async () => {
    setup();
    await using screen = await render(panel(false));
    const code = screen.getByTestId("code-tab");
    await expect.element(code).toHaveAttribute("data-background-refresh-token", "0");
    await expect.element(code).toHaveAttribute("data-refresh-token", "0");

    state.turn = 1;
    await screen.rerender(panel(true));
    state.turn = 3;
    await screen.rerender(panel(true));
    await expect.element(code).toHaveAttribute("data-background-refresh-token", "0");

    await screen.getByRole("button", { name: "More pull request actions" }).click();
    await page.getByRole("menuitem", { name: "Refresh" }).click();
    await expect.element(code).toHaveAttribute("data-refresh-token", "1");
    await expect.element(code).toHaveAttribute("data-background-refresh-token", "0");

    await screen.rerender(panel(false));
    await expect.element(code).toHaveAttribute("data-background-refresh-token", "3");
    await expect.element(code).toHaveAttribute("data-refresh-token", "1");
  });

  it("holds PR revision resets while allowing the updated title to render", async () => {
    setup();
    await using screen = await render(panel(false));
    const code = screen.getByTestId("code-tab");
    await expect.element(code).toHaveAttribute("data-refresh-token", "0");

    await screen.rerender(panel(true));
    state.detail = { ...detail, title: "Updated PR title", updatedAt: "2026-09-02T00:00:00Z" };
    await screen.rerender(panel(true));
    await expect.element(screen.getByRole("heading", { name: "Updated PR title" })).toBeVisible();
    await expect.element(code).toHaveAttribute("data-refresh-token", "0");

    await screen.rerender(panel(false));
    await expect.element(code).toHaveAttribute("data-refresh-token", "1");
    await expect.element(code).toHaveAttribute("data-background-refresh-token", "0");
  });
});
