import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { CommandId, type EnvironmentId, type InboxNotification } from "@t3tools/contracts";
import { useStableCallback } from "~/hooks/useStableCallback";
import { randomUUID } from "~/lib/utils";
import { inboxEnvironment } from "~/state/inbox";
import { useAtomCommand } from "~/state/use-atom-command";
import { FileSaveCoordinator } from "../files/fileSaveCoordinator";
import { Textarea } from "../ui/textarea";

/** Buffer notes like file edits: serialize writes and flush when the details panel closes. */
export function InboxFeedbackNotes({
  environmentId,
  notification,
  onSaved,
}: {
  environmentId: EnvironmentId;
  notification: Pick<InboxNotification, "id" | "projectId" | "revision" | "confirmedOutcome">;
  onSaved: () => void;
}) {
  const { id, projectId, revision, confirmedOutcome } = notification;
  const canWrite = useAtomValue(inboxEnvironment.mutate.permissionAtom(environmentId));
  const command = useAtomCommand(inboxEnvironment.mutate, { reportFailure: true });
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const savedRevision = useRef(revision);
  const expectedRevision = useStableCallback(() => Math.max(savedRevision.current, revision));
  const canPersist = useStableCallback(() => canWrite);
  const saved = useStableCallback((next: number) => {
    savedRevision.current = next;
    onSaved();
  });
  const coordinator = useRef<FileSaveCoordinator | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the debounced save coordinator for this note and flushes it when the note changes or unmounts.
  useEffect(() => {
    const save = new FileSaveCoordinator({
      debounceMs: 500,
      canPersist,
      onPendingChange: setPending,
      persist: async (text) => {
        setFailed(false);
        const result = await command({
          environmentId,
          input: {
            projectId,
            id,
            expectedRevision: expectedRevision(),
            commandId: CommandId.make(randomUUID()),
            action: { type: "outcome", text },
          },
        });
        if (result._tag === "Success") saved(result.value.notification.revision);
        else setFailed(true);
        return result;
      },
      onConfirmed: () => {},
    });
    coordinator.current = save;
    return () => {
      coordinator.current = null;
      save.dispose();
    };
  }, [canPersist, command, environmentId, expectedRevision, id, projectId, saved]);
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">Feedback &amp; notes</summary>
      <div className="mt-2 space-y-1">
        <Textarea
          aria-label="Feedback & notes"
          rows={3}
          maxLength={8000}
          readOnly={!canWrite}
          value={draft ?? confirmedOutcome ?? ""}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            setFailed(false);
            coordinator.current?.change(text);
          }}
          placeholder="Add feedback or notes…"
        />
        {failed ? (
          <p role="alert" className="text-2xs text-destructive">
            Couldn’t save notes.
            <button
              type="button"
              className="ml-1 underline"
              disabled={!canWrite}
              onClick={() => coordinator.current?.change(draft ?? confirmedOutcome ?? "")}
            >
              Retry
            </button>
          </p>
        ) : pending ? (
          <p role="status" className="text-2xs text-muted-foreground">
            Saving…
          </p>
        ) : null}
      </div>
    </details>
  );
}
