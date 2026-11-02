import type { InboxSource, InboxSourceConnection } from "@t3tools/contracts";

const sourceLabels: Record<InboxSource, string> = {
  slack: "Slack",
  superhuman: "Superhuman",
  linear: "Linear",
};

function timestamp(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function syncAge(elapsedMs: number) {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes === 0) return "Last synced just now";
  const age =
    minutes < 60
      ? `${minutes}m`
      : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `Last synced ${age} ago`;
}

/** Summarize only failed sources in the caller's scope, using the worst known delay. */
export function inboxIntegrationStatus(
  connections: ReadonlyArray<InboxSourceConnection>,
  now: number,
) {
  const failures = connections.filter((connection) => connection.enabled && connection.error);
  if (!failures.length) return null;
  let worstDelay = 0;
  const lines = Object.entries(sourceLabels).flatMap(([source, label]) => {
    const matching = failures.filter((connection) => connection.source === source);
    if (!matching.length) return [];
    let oldestSync = now;
    let neverSynced = false;
    for (const connection of matching) {
      const syncedAt = timestamp(connection.lastSyncAt);
      const startedAt = syncedAt ?? timestamp(connection.collectionStartedAt) ?? now;
      worstDelay = Math.max(worstDelay, now - startedAt);
      if (syncedAt === null) neverSynced = true;
      else oldestSync = Math.min(oldestSync, syncedAt);
    }
    return [
      `${label} updates delayed · ${neverSynced ? "Never synced" : syncAge(now - oldestSync)}`,
    ];
  });
  const progress = Math.max(0, Math.min(1, (worstDelay / 60_000 - 30) / 90));
  return { lines, color: `hsl(${58 * (1 - progress)} 90% 65%)` };
}
