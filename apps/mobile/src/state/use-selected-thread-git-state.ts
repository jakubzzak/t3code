import { useProjectGitEnabled } from "./use-project-git-enabled";
import { useMemo } from "react";

import { dedupeRemoteBranchesWithLocalMatches } from "@t3tools/shared/git";

import { useBranches } from "./queries";
import { useEnvironmentQuery } from "./query";
import { sourceControlEnvironment } from "./sourceControl";
import { useVcsActionState } from "./use-vcs-action-state";
import { useThreadSelection } from "./use-thread-selection";
import { useSelectedThreadWorktree } from "./use-selected-thread-worktree";

export function useSelectedThreadGitState() {
  const { selectedThread } = useThreadSelection();
  const gitEnabled = useProjectGitEnabled(
    selectedThread?.environmentId ?? null,
    selectedThread?.projectId ?? null,
  );
  const { selectedThreadCwd } = useSelectedThreadWorktree();

  const selectedThreadGitTarget = {
    environmentId: selectedThread?.environmentId ?? null,
    cwd: gitEnabled ? selectedThreadCwd : null,
  };
  const gitActionState = useVcsActionState(selectedThreadGitTarget);
  const sourceControlDiscovery = useEnvironmentQuery(
    !gitEnabled || selectedThread === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId: selectedThread.environmentId,
          input: {},
        }),
  );

  const selectedThreadBranchTarget = {
    environmentId: selectedThread?.environmentId ?? null,
    cwd: gitEnabled ? selectedThreadCwd : null,
    query: null,
  };
  const selectedThreadBranchState = useBranches(selectedThreadBranchTarget);
  const selectedThreadBranches = useMemo(
    () =>
      dedupeRemoteBranchesWithLocalMatches(selectedThreadBranchState.data?.refs ?? []).filter(
        (branch) => !branch.isRemote,
      ),
    [selectedThreadBranchState.data?.refs],
  );

  return {
    gitOperationLabel: gitActionState.currentLabel,
    sourceControlDiscovery,
    selectedThreadBranches,
    selectedThreadBranchesLoading: selectedThreadBranchState.isPending,
  };
}
