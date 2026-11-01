import { useEffect, useRef } from "react";
import { PaperclipIcon, XIcon } from "lucide-react";
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
import {
  runAttachmentUploadCycle,
  deletePendingAttachmentUpload,
} from "@t3tools/client-runtime/state/attachments";
import { attachmentEnvironment } from "~/state/attachments";
import { readPreparedConnection } from "~/state/session";
import { resolveAssetUrl } from "~/assets/assetUrls";
import type { InboxReplyImage } from "@t3tools/contracts";
import { InboxImage } from "./InboxImage";

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
  const fileInput = useRef<HTMLInputElement>(null);
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
  const locked =
    draft?.pending ||
    draft?.uploading ||
    uncertain ||
    (!!draft?.error && !draft?.result) ||
    !permitted;
  useEffect(() => {
    if (draft?.open) textarea.current?.focus();
  }, [draft?.open]);
  if (!draft?.open) return null;
  const discardImage = (attachmentId: string) =>
    deletePendingAttachmentUpload({
      registry: appAtomRegistry,
      remove: attachmentEnvironment.remove,
      environmentId,
      attachmentId,
    });
  async function attach(files: File[]) {
    const value = useInboxReplyDrafts.getState().drafts[key];
    if (!value || locked || n.source !== "slack") return;
    if ((value.input.images?.length ?? 0) + files.length > 4) {
      updateInboxReply(key, (value) => ({ ...value, uploadError: "Attach up to four images." }));
      return;
    }
    updateInboxReply(key, (value) => ({ ...value, uploading: true, uploadError: undefined }));
    try {
      for (const file of files) {
        const mimeType = file.type;
        if (
          mimeType !== "image/png" &&
          mimeType !== "image/jpeg" &&
          mimeType !== "image/gif" &&
          mimeType !== "image/webp"
        )
          throw new Error("Choose a PNG, JPEG, GIF, or WebP image.");
        if (!file.size || file.size > 10 * 1024 * 1024)
          throw new Error("Each image must be under 10 MB.");
        const result = await runAttachmentUploadCycle({
          registry: appAtomRegistry,
          createUploadUrl: attachmentEnvironment.createUploadUrl,
          remove: attachmentEnvironment.remove,
          environmentId,
          upload: { name: file.name, mimeType, sizeBytes: file.size },
          resolveUploadUrl: (relative) => {
            const connection = readPreparedConnection(environmentId);
            return connection ? resolveAssetUrl(connection.httpBaseUrl, relative) : null;
          },
          transport: (url) => {
            const controller = new AbortController();
            return {
              abort: () => controller.abort(),
              done: fetch(url, {
                method: "POST",
                body: file,
                headers: { "Content-Type": mimeType },
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
              }).then((response) => {
                if (!response.ok) throw new Error("Image upload failed. Try again.");
              }),
            };
          },
        });
        if (result.status !== "uploaded") {
          if (result.attachmentId) discardImage(result.attachmentId);
          throw new Error("Image upload failed. Try again.");
        }
        const image: InboxReplyImage = {
          attachmentId: result.attachmentId,
          name: file.name,
          mimeType,
          sizeBytes: file.size,
        };
        updateInboxReply(key, (value) => ({
          ...value,
          result: undefined,
          error: undefined,
          input: {
            ...value.input,
            commandId: CommandId.make(randomUUID()),
            images: [...(value.input.images ?? []), image],
          },
        }));
      }
    } catch (cause) {
      updateInboxReply(key, (value) => ({
        ...value,
        uploadError: cause instanceof Error ? cause.message : "Image upload failed.",
      }));
    } finally {
      updateInboxReply(key, (value) => ({ ...value, uploading: false }));
    }
  }
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
      value.uploading ||
      !permitted ||
      (!value.input.text.trim() && !value.input.images?.length) ||
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
      if (result.value.status === "sent") {
        for (const image of input.images ?? []) discardImage(image.attachmentId);
        close();
      }
    } else {
      // Rechecking this command ID is safe even when the RPC response was lost.
      updateInboxReply(key, (draft) => ({
        ...draft,
        pending: false,
        error:
          "Could not confirm delivery. Check the original conversation. Send checks this attempt without posting again.",
      }));
    }
    if (!AsyncResult.isSuccess(result) || result.value.status !== "sent") refresh();
  }
  async function cancel() {
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
    for (const image of draft?.input.images ?? []) discardImage(image.attachmentId);
    updateInboxReply(key, (value) => ({
      ...value,
      open: false,
      result: undefined,
      error: undefined,
      uploadError: undefined,
      input: { ...value.input, text: "", images: [], commandId: CommandId.make(randomUUID()) },
    }));
    refresh();
    onClose?.();
  }
  const source = connection.data?.find((source) => source.source === n.source);
  return (
    <section
      aria-label="Reply to notification"
      className="mt-2 space-y-2 border-t border-border/60 pt-2"
      onClick={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        if (n.source === "slack" && event.dataTransfer.types.includes("Files"))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (n.source !== "slack" || !event.dataTransfer.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        void attach(Array.from(event.dataTransfer.files));
      }}
    >
      <p className="text-2xs text-muted-foreground">Thread reply</p>
      {source?.canReply === false && (
        <p className="text-2xs text-muted-foreground">
          Reconnect {n.source === "slack" ? "Slack" : "Linear"} in Settings → Integrations to enable
          replies. Your draft is kept.
        </p>
      )}
      <div className="rounded-lg border border-input bg-background text-xs leading-relaxed focus-within:border-ring focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring/24">
        {!!draft.input.images?.length && (
          <div className="grid grid-cols-[repeat(2,4rem)] gap-2 px-2 pt-2">
            {draft.input.images.map((image) => (
              <div key={image.attachmentId} className="group/attachment relative">
                <InboxImage
                  environmentId={environmentId}
                  name={image.name}
                  resource={{ _tag: "attachment", attachmentId: image.attachmentId }}
                />
                <span className="pointer-events-none absolute right-1 top-1 flex opacity-0 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 group-hover/attachment:pointer-events-auto group-hover/attachment:opacity-100 group-focus-within/attachment:pointer-events-auto group-focus-within/attachment:opacity-100">
                  <Button
                    size="icon-xs"
                    variant="media-close"
                    disabled={locked}
                    aria-label={`Remove ${image.name}`}
                    onClick={() => {
                      discardImage(image.attachmentId);
                      updateInboxReply(key, (value) => ({
                        ...value,
                        result: undefined,
                        error: undefined,
                        input: {
                          ...value.input,
                          commandId: CommandId.make(randomUUID()),
                          images:
                            value.input.images?.filter(
                              (entry) => entry.attachmentId !== image.attachmentId,
                            ) ?? [],
                        },
                      }));
                    }}
                  >
                    <XIcon />
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
        <Textarea
          unstyled
          className="block"
          ref={textarea}
          size="sm"
          aria-label="Reply"
          placeholder="Write a reply…"
          maxLength={4000}
          value={draft.input.text}
          disabled={locked}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (n.source === "slack" && files.length) {
              event.preventDefault();
              void attach(files);
            }
          }}
          onChange={(event) =>
            updateInboxReply(key, (value) => ({
              ...value,
              error: undefined,
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
              void submit();
            }
          }}
        />
      </div>
      {draft.uploadError && (
        <p role="alert" className="text-2xs text-destructive">
          {draft.uploadError}
        </p>
      )}
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
          disabled={
            !permitted ||
            draft.pending ||
            draft.uploading ||
            (!draft.input.text.trim() && !draft.input.images?.length)
          }
          onClick={() => void submit()}
        >
          {draft.pending ? "Sending…" : "Send"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={draft.pending || draft.uploading}
          onClick={() => void cancel()}
        >
          Cancel
        </Button>
        {n.source === "slack" && !uncertain && (
          <div className="ml-auto flex items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              aria-label="Attach images"
              onChange={(event) => {
                void attach(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            {draft.uploading && (
              <span role="status" className="text-2xs text-muted-foreground">
                Uploading…
              </span>
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={locked}
              aria-label="Attach images"
              title="Attach images"
              aria-busy={draft.uploading}
              onClick={() => fileInput.current?.click()}
            >
              <PaperclipIcon aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
