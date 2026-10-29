import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { CommandId, type EnvironmentId, type InboxNotification } from "@t3tools/contracts";
import { inboxEnvironment } from "~/state/inbox";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentQuery } from "~/state/query";
import { randomUUID } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { inboxReplyKey, updateInboxReply, useInboxReplyDrafts } from "./inboxReplyDraft";

export function InboxReplyComposer({
  environmentId,
  notification: n,
  onClose,
}: {
  environmentId: EnvironmentId;
  notification: InboxNotification;
  onClose?: (() => void) | undefined;
}) {
  const key = inboxReplyKey(environmentId, n.id);
  const draft = useInboxReplyDrafts((state) => state.drafts[key]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const permitted = useAtomValue(inboxEnvironment.reply.permissionAtom(environmentId));
  const send = useAtomCommand(inboxEnvironment.reply, { reportFailure: false });
  const mutate = useAtomCommand(inboxEnvironment.mutate, { reportFailure: true });
  const connection = useEnvironmentQuery(
    draft?.open
      ? inboxEnvironment.sources({ environmentId, input: { projectId: n.projectId } })
      : null,
  );
  const detail = useEnvironmentQuery(
    draft?.open
      ? inboxEnvironment.get({ environmentId, input: { projectId: n.projectId, id: n.id } })
      : null,
  );
  const current = detail.data ?? n;
  const attempt = draft?.result ?? current.replyAttempt;
  const uncertain = attempt?.status === "pending" || attempt?.status === "uncertain";
  useEffect(() => {
    if (draft?.open) textarea.current?.focus();
  }, [draft?.open]);
  if (!draft?.open) return null;
  const close = () => {
    updateInboxReply(key, (value) => ({ ...value, open: false }));
    onClose?.();
  };
  const refresh = () => {
    detail.refresh();
    appAtomRegistry.refresh(
      inboxEnvironment.list({ environmentId, input: { projectId: n.projectId } }),
    );
  };
  async function submit() {
    const value = useInboxReplyDrafts.getState().drafts[key];
    if (
      !value ||
      value.pending ||
      !permitted ||
      !value.input.text.trim() ||
      value.result?.status === "sent"
    )
      return;
    updateInboxReply(key, (draft) => ({ ...draft, pending: true, error: undefined }));
    const input =
      value.result?.status === "failed"
        ? { ...value.input, commandId: CommandId.make(randomUUID()) }
        : value.input;
    updateInboxReply(key, (draft) => ({ ...draft, input }));
    const result = await send({ environmentId, input });
    if (AsyncResult.isSuccess(result)) {
      updateInboxReply(key, (draft) => ({
        ...draft,
        pending: false,
        result: result.value,
        error: result.value.error,
      }));
      if (result.value.status === "sent") close();
    } else {
      // Rechecking this command ID is safe even when the RPC response was lost.
      updateInboxReply(key, (draft) => ({
        ...draft,
        pending: false,
        error:
          "The send result is unavailable. Check the original conversation or check this attempt's status before trying another reply.",
      }));
    }
    refresh();
  }
  async function ignore() {
    const result = await mutate({
      environmentId,
      input: {
        projectId: n.projectId,
        id: n.id,
        commandId: CommandId.make(randomUUID()),
        expectedRevision: current.revision,
        action: { type: "ignore-reply" },
      },
    });
    if (!AsyncResult.isSuccess(result)) return;
    updateInboxReply(key, (value) => ({
      ...value,
      open: false,
      result: undefined,
      error: undefined,
      input: { ...value.input, text: "", commandId: CommandId.make(randomUUID()) },
    }));
    refresh();
    onClose?.();
  }
  const target = draft.input.target;
  const source = connection.data?.find((source) => source.source === n.source);
  const account = source?.account ?? n.connectionId;
  return (
    <section
      aria-label="Reply to notification"
      className="mt-2 space-y-2 border-t border-border/60 pt-2"
      onClick={(event) => event.stopPropagation()}
    >
      <p className="break-words text-2xs text-muted-foreground">
        As {account} ·{" "}
        {n.items.find((item) => item.id === draft.input.itemId)?.location ?? n.source} ·{" "}
        {target.source === "slack"
          ? "Thread reply"
          : target.parentId
            ? "Comment reply"
            : "Issue comment"}
      </p>
      {source?.canReply === false && (
        <p className="text-2xs text-muted-foreground">
          Reconnect {n.source === "slack" ? "Slack" : "Linear"} in Settings → Integrations to enable
          replies. Your draft is kept.
        </p>
      )}
      <Textarea
        ref={textarea}
        size="sm"
        aria-label="Reply"
        placeholder="Write a reply…"
        maxLength={4000}
        value={draft.input.text}
        disabled={draft.pending || uncertain || (!!draft.error && !draft.result) || !permitted}
        onChange={(event) =>
          updateInboxReply(key, (value) => ({
            ...value,
            input: {
              ...value.input,
              text: event.target.value,
              commandId:
                value.result?.status === "failed"
                  ? CommandId.make(randomUUID())
                  : value.input.commandId,
            },
            result: value.result?.status === "failed" ? undefined : value.result,
          }))
        }
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!draft.pending) close();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            if (!uncertain) void submit();
          }
        }}
      />
      {(draft.error || (uncertain && !draft.pending)) && (
        <p role="alert" className="text-2xs text-destructive">
          {draft.error ??
            attempt?.error ??
            "Delivery is uncertain. Check the original conversation. This attempt will not be sent again."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="xs"
          disabled={!permitted || draft.pending || uncertain || !draft.input.text.trim()}
          onClick={() => void submit()}
        >
          {draft.pending ? "Sending…" : "Send"}
        </Button>
        {draft.error && draft.result?.status !== "failed" && (
          <Button size="xs" variant="ghost" disabled={draft.pending} onClick={() => void submit()}>
            Check result
          </Button>
        )}
        <Button size="xs" variant="ghost" disabled={draft.pending} onClick={() => void ignore()}>
          {uncertain ? "Discard after checking source" : "Ignore"}
        </Button>
        <Button size="xs" variant="ghost" disabled={draft.pending} onClick={close}>
          Close
        </Button>
      </div>
    </section>
  );
}
