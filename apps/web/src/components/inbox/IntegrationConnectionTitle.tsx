import { useEffect, useState } from "react";
import { InboxTimestampLabel } from "./InboxTimestampLabel";
import { formatInboxSyncTimestamp } from "./inboxTimestampFormat";

/** Ticks a minute after each mount, so labels age from the sync rather than the wall clock. */
function useSyncAgeClock() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps a minute timer running while this sync label is mounted.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return nowMs;
}

function SyncTimestamp({ timestamp }: { timestamp: string }) {
  const nowMs = useSyncAgeClock();
  const value = formatInboxSyncTimestamp(timestamp, nowMs);
  if (!value) return null;
  return (
    <span className="text-xs font-normal text-muted-foreground">
      <InboxTimestampLabel timestamp={timestamp} label="Last synced">
        {value}
      </InboxTimestampLabel>
    </span>
  );
}

/** Mount the clock only for a known sync; a new sync resets its minute snapshot. */
export function IntegrationConnectionTitle({ lastSyncAt }: { lastSyncAt?: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      Connection
      {lastSyncAt && " "}
      {lastSyncAt && <SyncTimestamp key={lastSyncAt} timestamp={lastSyncAt} />}
    </span>
  );
}
