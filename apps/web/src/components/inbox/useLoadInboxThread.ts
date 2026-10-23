import { useCallback } from "react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { inboxEnvironment } from "~/state/inbox";
import { useAtomCommand } from "~/state/use-atom-command";

export function useLoadInboxThread() {
  const command = useAtomCommand(inboxEnvironment.loadPreviousComments, { reportFailure: false });
  return useCallback(
    async (environmentId: EnvironmentId, projectId: ProjectId, id: string) => {
      const result = await command({
        environmentId,
        input: { projectId, id, loadPreviousComments: true },
      });
      if (result._tag === "Success") {
        const comments = result.value?.slackThread ?? result.value?.linearIssue;
        if (comments) return comments;
      }
      if (isAtomCommandInterrupted(result))
        throw new Error("Loading thread comments was cancelled.");
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      throw new Error("Thread comments are not available. Try syncing again.");
    },
    [command],
  );
}
