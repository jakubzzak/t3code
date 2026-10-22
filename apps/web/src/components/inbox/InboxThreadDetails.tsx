import { useEffect, useState } from "react";
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
import { InboxSourceContent } from "./InboxSidebarLayout";
import { InboxSourceLogo } from "./InboxSourceLogo";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export function InboxThreadDetails({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const thread = useThreadShell({ environmentId, threadId });
  const config = useServerConfigs().get(environmentId);
  const enabled =
    thread &&
    config?.notificationInbox &&
    resolveProjectSettings(config.settings, thread.projectId).settings.inboxEnabled;
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
  const canWrite = useAtomValue(inboxEnvironment.mutate.permissionAtom(environmentId));
  const command = useAtomCommand(inboxEnvironment.mutate, { reportFailure: true });
  const [outcome, setOutcome] = useState<string | null>(null);
  const n = detail.data ?? notification;
  if (!n) return null;
  return (
    <ThreadDetailsSection headingId="thread-notification-heading" title="Notification" separated>
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-xs">
          <InboxSourceLogo source={n.source} />
          <span className="truncate">{n.items.at(-1)?.location}</span>
        </div>
        <p className="mt-1 text-xs font-medium">
          {n.analysis?.description ?? n.items.at(-1)?.title}
        </p>
        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{n.items.at(-1)?.content}</p>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Context and AI summary</summary>
          <InboxSourceContent notification={detail.data ?? { ...n, analysis: null }} />
        </details>
        {detail.error && (
          <p role="alert" className="text-xs text-destructive">
            {detail.error}
            <button type="button" onClick={detail.refresh} className="ml-1 underline">
              Retry
            </button>
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            useInboxNavigation.setState({
              tab: "inbox",
              revealId: n.id,
              revealed: { environmentId, notification: n },
            })
          }
        >
          Show in Inbox
        </Button>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Record confirmed outcome
          </summary>
          <div className="mt-2 space-y-2">
            <Textarea
              aria-label="Confirmed outcome"
              rows={3}
              maxLength={8000}
              value={outcome ?? n.confirmedOutcome ?? ""}
              onChange={(event) => setOutcome(event.target.value)}
              placeholder="What actually resolved this request?"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!canWrite}
              onClick={() =>
                void command({
                  environmentId,
                  input: {
                    projectId: n.projectId,
                    id: n.id,
                    expectedRevision: n.revision,
                    commandId: CommandId.make(randomUUID()),
                    action: { type: "outcome", text: outcome ?? n.confirmedOutcome ?? "" },
                  },
                }).then(() => {
                  detail.refresh();
                  list.refresh();
                })
              }
            >
              Save outcome
            </Button>
          </div>
        </details>
      </div>
    </ThreadDetailsSection>
  );
}
