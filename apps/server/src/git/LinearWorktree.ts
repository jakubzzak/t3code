import { LinearIssueSetupError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@t3tools/shared/git";
import { GitVcsDriver, type CreateWorktreeOptions } from "../vcs/GitVcsDriver.ts";
import { ServerConfig } from "../config.ts";

export const prepareLinearWorktree = Effect.fn("LinearWorktree.prepare")(function* (input: {
  cwd: string;
  projectId: string;
  branchName: string;
  baseRef: string;
  submodules?: CreateWorktreeOptions["submodules"];
}) {
  const git = yield* GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const run = (args: string[], allowNonZeroExit = false) =>
    git.execute({
      cwd: input.cwd,
      args,
      allowNonZeroExit,
      operation: "LinearWorktree.prepare",
      timeoutMs: 60_000,
    });
  const checked = yield* run(["check-ref-format", "--branch", input.branchName], true);
  if (checked.exitCode !== 0 || checked.stdout.trim() !== input.branchName) {
    return yield* new LinearIssueSetupError({
      detail: "Linear's suggested branch name cannot be used by Git.",
    });
  }
  const worktrees = yield* run(["worktree", "list", "--porcelain", "-z"]);
  for (const record of worktrees.stdout.split("\0\0")) {
    const fields = record.split("\0");
    if (!fields.includes(`branch refs/heads/${input.branchName}`)) continue;
    const existing = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    if (existing && (yield* fs.exists(existing))) return { path: existing, created: false };
    return yield* new LinearIssueSetupError({
      detail: "The branch has a missing worktree. Repair or prune it before trying again.",
    });
  }
  const local = yield* run(
    ["show-ref", "--verify", "--quiet", `refs/heads/${input.branchName}`],
    true,
  );
  if (local.exitCode !== 0 && local.exitCode !== 1) {
    return yield* new LinearIssueSetupError({
      detail: "Unable to inspect the local Linear branch.",
    });
  }
  let remote: string | undefined;
  let refName = local.exitCode === 0 ? input.branchName : input.baseRef;
  if (local.exitCode !== 0) {
    const remotes = yield* run(["remote"]);
    const matches: string[] = [];
    for (const name of remotes.stdout.trim().split("\n").filter(Boolean)) {
      const url = yield* run(["config", "--get", `remote.${name}.url`]);
      if (!parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url.stdout.trim())) continue;
      const advertised = yield* run(
        ["ls-remote", "--exit-code", "--heads", "--", name, `refs/heads/${input.branchName}`],
        true,
      );
      if (advertised.exitCode === 0) matches.push(name);
      else if (advertised.exitCode !== 2)
        return yield* new LinearIssueSetupError({
          detail: `Unable to check the Linear branch on GitHub remote '${name}'. Check access and retry.`,
        });
    }
    if (matches.length > 1)
      return yield* new LinearIssueSetupError({
        detail:
          "This branch exists on multiple GitHub remotes. Check it out locally to choose the intended repository, then retry.",
      });
    remote = matches[0];
    if (remote) {
      yield* git.fetchRemoteTrackingBranch({
        cwd: input.cwd,
        remoteName: remote,
        remoteBranch: input.branchName,
      });
      refName = `refs/remotes/${remote}/${input.branchName}`;
    }
  }
  // Escape the directory component without changing the actual Git branch.
  const directory = encodeURIComponent(input.branchName).replace(
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i,
    (name) => `%${name.charCodeAt(0).toString(16)}${name.slice(1)}`,
  );
  const projectDirectory = `${path.basename(input.cwd)}-${encodeURIComponent(input.projectId)}`;
  const worktreePath = path.join(config.worktreesDir, projectDirectory, directory);
  if (yield* fs.exists(worktreePath))
    return yield* new LinearIssueSetupError({
      detail:
        "The Linear worktree directory already exists but is not registered for this branch. Resolve the directory conflict and retry.",
    });
  yield* fs.makeDirectory(path.dirname(worktreePath), { recursive: true });
  const result = yield* git.createWorktree(
    {
      cwd: input.cwd,
      path: worktreePath,
      refName,
      ...(local.exitCode === 0 ? {} : { newRefName: input.branchName }),
      baseRefName: input.baseRef,
    },
    { submodules: input.submodules ?? null },
  );
  if (remote)
    yield* git.setBranchUpstream({
      cwd: input.cwd,
      branch: input.branchName,
      remoteName: remote,
      remoteBranch: input.branchName,
    });
  return { path: yield* fs.realPath(result.worktree.path), created: true };
});
