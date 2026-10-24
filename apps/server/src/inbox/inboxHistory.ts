import * as DateTime from "effect/DateTime";
import { ProjectId, type ServerSettings } from "@t3tools/contracts";

/** Stamp the settings commit, rather than the first poll or a client's clock. */
export function stampInboxEnabledAt(
  current: ServerSettings | undefined,
  next: ServerSettings,
  now: string,
): ServerSettings {
  const times = { ...next.inboxEnabledAtByProject };
  let changed = false;
  for (const [key, project] of Object.entries(next.projectSettingsOverrides)) {
    const id = ProjectId.make(key);
    if (project.inboxEnabled !== true) continue;
    if (!times[id] || (current && current.projectSettingsOverrides[id]?.inboxEnabled !== true)) {
      times[id] = now;
      changed = true;
    }
  }
  for (const key of Object.keys(times)) {
    const id = ProjectId.make(key);
    if (next.projectSettingsOverrides[id]?.inboxEnabled !== true) {
      delete times[id];
      changed = true;
    }
  }
  return changed ? { ...next, inboxEnabledAtByProject: times } : next;
}

/** Subsequent reads resume at the successful fetch start, within the selected history boundary. */
export function inboxHistorySince(
  enabledAt: string,
  days: number,
  now: number,
  lastSyncAt: string | null,
): string {
  return DateTime.formatIso(
    DateTime.makeUnsafe(
      Math.max(
        Date.parse(enabledAt) - days * 86_400_000,
        lastSyncAt ? Date.parse(lastSyncAt) : now - 30 * 86_400_000,
      ),
    ),
  );
}
