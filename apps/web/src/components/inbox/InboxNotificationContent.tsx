import type { InboxNotification } from "@t3tools/contracts";
import { SparklesIcon } from "lucide-react";

export function InboxSummary({
  notification,
  expanded = false,
}: {
  notification: InboxNotification;
  expanded?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 text-xs leading-relaxed">
      {notification.analysis?.summary ? (
        <>
          <div className="mb-1 flex items-center gap-1 text-2xs font-normal text-muted-foreground">
            <SparklesIcon className="size-3" />
            AI summary
          </div>
          <p className={`whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-3"}`}>
            {notification.analysis.summary}
          </p>
        </>
      ) : (
        <>
          <p>{notification.items.at(-1)?.title}</p>
          <p className="mt-1 text-2xs font-normal text-muted-foreground">
            {notification.processingError ?? "AI summary pending"}
          </p>
        </>
      )}
    </div>
  );
}

export function InboxSourceContent({ notification }: { notification: InboxNotification }) {
  const suggestions = notification.analysis?.suggestions ?? [];
  return (
    <div className="space-y-3 py-2 text-xs leading-relaxed">
      {suggestions.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Suggested next steps</p>
          <ul className="list-disc space-y-1 pl-4">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-3 border-t border-border/50 pt-2">
        <p className="text-2xs text-muted-foreground">Original message</p>
        {notification.items.map((item) => (
          <div key={item.id}>
            <div className="mb-1 text-2xs text-muted-foreground">
              {item.author} · {item.location}
            </div>
            <p className="whitespace-pre-wrap break-words">{item.content}</p>
            {/^https?:\/\//i.test(item.url) && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-2xs text-primary underline"
              >
                Open original
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
