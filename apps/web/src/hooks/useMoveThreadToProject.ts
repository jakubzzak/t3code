import { randomUUID } from "../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { CommandId, type ScopedThreadRef, type ProjectId } from "@t3tools/contracts";
import { useCallback } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useProjects, useServerConfigs, readThreadShell } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { readLocalApi } from "../localApi";
import { toastManager } from "../components/ui/toast";

export const MOVE_CHAT_SEARCH_TERMS = [
  "Move chat to project…",
  "move chat",
  "move thread",
  "change project",
  "switch project",
  "move conversation",
  "workspace",
  "directory",
  "repository",
  "repo",
  "handoff",
];

/** Both pickers dispatch the same server-owned, immediately queued handoff. */
export function useMoveThreadToProject(
  threadRef: ScopedThreadRef | null,
  projectId: ProjectId | null,
) {
  const projects = useProjects();
  const configs = useServerConfigs();
  const supported =
    threadRef !== null &&
    configs.get(threadRef.environmentId)?.environment.capabilities.threadProjectMove === true;
  const permitted = useAtomValue(
    threadEnvironment.moveToProject.permissionAtom(threadRef?.environmentId ?? null),
  );
  const canMove = supported && permitted;
  const execute = useAtomCommand(threadEnvironment.moveToProject, { reportFailure: false });
  const destinations = projects.filter(
    (project) => project.environmentId === threadRef?.environmentId && project.id !== projectId,
  );
  const move = useCallback(
    async (destinationId: ProjectId) => {
      if (!threadRef || !canMove) return;
      const result = await execute({
        environmentId: threadRef.environmentId,
        input: {
          commandId: CommandId.make(randomUUID()),
          threadId: threadRef.threadId,
          projectId: destinationId,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not move chat",
          description:
            error instanceof Error ? error.message : "The project move was not accepted.",
        });
      }
    },
    [threadRef, canMove, execute],
  );
  const openMenu = useCallback(
    async (position: { x: number; y: number }) => {
      if (!threadRef) return;
      const current = readThreadShell(threadRef);
      if (!current) return;
      const choices = projects.filter(
        (project) =>
          project.environmentId === threadRef.environmentId && project.id !== current.projectId,
      );
      const selected = await readLocalApi()?.contextMenu.show<string>(
        choices.length
          ? choices.map((project) => ({
              id: project.id,
              label:
                project.projectIcon?.kind === "emoji"
                  ? `${project.projectIcon.emoji} ${project.title}`
                  : project.title,
              icon: "folder",
              disabled: !canMove,
            }))
          : [{ id: "empty", label: "No other projects", disabled: true }],
        position,
      );
      const destination = choices.find((project) => project.id === selected);
      if (destination) await move(destination.id);
    },
    [threadRef, projects, canMove, move],
  );
  return { destinations, canMove, move, openMenu };
}
