import { useRelativeTimeTick } from "../settings/settingsLayout";
import { InboxTimestampLabel } from "./InboxTimestampLabel";
import { formatInboxSyncTimestamp } from "./inboxTimestampFormat";

function SyncTimestamp({ timestamp }: { timestamp: string }) {
  const nowMs = useRelativeTimeTick(60_000);
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
