import { useCallback, useEffect, useMemo, useRef } from "react";
import { InboxIcon, ReplyIcon } from "lucide-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CommandId } from "@t3tools/contracts";
import { randomUUID } from "~/lib/utils";
import { useThreadShell, useServerConfigs } from "~/state/entities";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { inboxEnvironment } from "~/state/inbox";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomValue } from "@effect/atom-react";
import { useInboxNavigation } from "./inboxNavigation";
import {
  InboxOpenOriginalAction,
  InboxSourceContent,
  InboxSummary,
} from "./InboxNotificationContent";
import { InboxNotificationMetadata } from "./InboxNotificationMetadata";
import { InboxFeedbackNotes } from "./InboxFeedbackNotes";
import { useLoadInboxThread } from "./useLoadInboxThread";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { InboxReplyComposer } from "./InboxReplyComposer";
import { inboxReplyTarget, openInboxReply } from "./inboxReplyDraft";
import { Button } from "../ui/button";

export function InboxThreadDetails({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const sourceRef = useRef<HTMLDetailsElement>(null);
  const replyRef = useRef<HTMLButtonElement>(null);
  const loadThread = useLoadInboxThread();
  const threadRef = useMemo(() => ({ environmentId, threadId }), [environmentId, threadId]);
  const thread = useThreadShell({ environmentId, threadId });
  const config = useServerConfigs().get(environmentId);
  const enabled =
    thread &&
    config?.notificationInbox &&
    resolveProjectSettings(config.settings, thread.projectId).settings.inboxEnabled;
  const memoryEnabled =
    thread &&
    config &&
    resolveProjectSettings(config.settings, thread.projectId).settings.inboxMemoryEnabled;
  const list = useEnvironmentQuery(
    enabled
      ? inboxEnvironment.list({ environmentId, input: { projectId: thread.projectId, threadId } })
      : null,
  );
  const notification = list.data?.[0];
  const detail = useEnvironmentQuery(
    notification
      ? inboxEnvironment.get({
          environmentId,
          input: { projectId: notification.projectId, id: notification.id },
        })
      : null,
  );
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        list.refresh();
        detail.refresh();
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [enabled, list.refresh, detail.refresh]);
  const canReply = useAtomValue(inboxEnvironment.reply.permissionAtom(environmentId));
  const canWrite = useAtomValue(inboxEnvironment.mutate.permissionAtom(environmentId));
  const command = useAtomCommand(inboxEnvironment.mutate, { reportFailure: true });
  const refresh = useCallback(() => {
    detail.refresh();
    list.refresh();
  }, [detail, list]);
  const n = detail.data ?? notification;
  if (!n) return null;
  return (
    <div className="border-b border-border/65">
      <ThreadDetailsSection
        headingId="thread-notification-heading"
        title="Notification"
        separated
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Show in Inbox"
              title="Show in Inbox"
              onClick={() =>
                useInboxNavigation.setState({
                  tab: "inbox",
                  revealId: n.id,
                  revealed: { environmentId, notification: n },
                })
              }
            >
              <InboxIcon className="size-3.5" />
            </Button>
            {(n.source === "slack" || n.source === "linear") && (
              <Button
                ref={replyRef}
                variant="ghost"
                size="icon-xs"
                aria-label="Reply"
                title="Reply"
                disabled={!canReply || !inboxReplyTarget(n)}
                onClick={() => {
                  if (sourceRef.current) sourceRef.current.open = true;
                  openInboxReply(environmentId, n);
                }}
              >
                <ReplyIcon className="size-3.5" />
              </Button>
            )}
            <InboxOpenOriginalAction notification={n} threadRef={threadRef} />
          </>
        }
      >
        <div className="px-2.5 py-2">
          <InboxNotificationMetadata notification={n} />
          <div className="mt-2">
            <InboxSummary
              threadRef={threadRef}
              notification={n}
              expanded
              onRetrySuggestion={
                canWrite
                  ? () => {
                      void command({
                        environmentId,
                        input: {
                          projectId: n.projectId,
                          id: n.id,
                          expectedRevision: n.revision,
                          commandId: CommandId.make(randomUUID()),
                          action: { type: "retry-suggestion" },
                        },
                      }).then(() => {
                        detail.refresh();
                        list.refresh();
                      });
                    }
                  : undefined
              }
              suggestionsEnabled={
                !!(
                  thread &&
                  config &&
                  resolveProjectSettings(config.settings, thread.projectId).settings
                    .inboxPreResolution
                )
              }
              enabled={
                !!(
                  thread &&
                  config &&
                  resolveProjectSettings(config.settings, thread.projectId).settings
                    .inboxSummaryEnabled
                )
              }
            />
          </div>
          <details ref={sourceRef} className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Original message and context
            </summary>
            {detail.data ? (
              <InboxSourceContent
                environmentId={environmentId}
                notification={detail.data}
                threadRef={threadRef}
                onLoadPrevious={() =>
                  loadThread(environmentId, detail.data!.projectId, detail.data!.id)
                }
              />
            ) : (
              <p className="py-2 text-muted-foreground">{detail.error ?? "Loading context…"}</p>
            )}
            <InboxReplyComposer
              environmentId={environmentId}
              notification={n}
              onClose={() => replyRef.current?.focus()}
            />
          </details>
          {detail.error && (
            <p role="alert" className="text-xs text-destructive">
              {detail.error}
              <button type="button" onClick={detail.refresh} className="ml-1 underline">
                Retry
              </button>
            </p>
          )}
          {memoryEnabled && (
            <InboxFeedbackNotes
              key={`${environmentId}:${n.id}`}
              environmentId={environmentId}
              notification={n}
              onSaved={refresh}
            />
          )}
        </div>
      </ThreadDetailsSection>
    </div>
  );
}
