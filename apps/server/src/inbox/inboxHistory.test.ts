import { expect, it } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS, ProjectId, type ServerSettings } from "@t3tools/contracts";
import { inboxHistorySince, stampInboxEnabledAt } from "./inboxHistory.ts";

it("anchors zero to enable time across repeated syncs and enforces the 30 day maximum", () => {
  const enabled = "2026-10-22T10:00:00.000Z";
  const now = Date.parse(enabled) + 60_000;
  expect(inboxHistorySince(enabled, 0, now, null)).toBe(enabled);
  expect(inboxHistorySince(enabled, 0, now, "2026-10-22T10:00:30.000Z")).toBe(enabled);
  expect(inboxHistorySince(enabled, 30, now, null)).toBe("2026-09-22T10:01:00.000Z");
  expect(inboxHistorySince(enabled, 7, now, null)).toBe("2026-10-15T10:00:00.000Z");
});

it("stamps only activation, isolates projects, and restarts the boundary on re-enable", () => {
  const initial: ServerSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    projectSettingsOverrides: {
      [ProjectId.make("one")]: { inboxEnabled: true },
      [ProjectId.make("two")]: { inboxEnabled: false },
    },
  };
  const first = stampInboxEnabledAt(DEFAULT_SERVER_SETTINGS, initial, "2026-10-22T10:00:00.000Z");
  expect(first.inboxEnabledAtByProject).toEqual({ one: "2026-10-22T10:00:00.000Z" });
  expect(stampInboxEnabledAt(undefined, first, "2026-10-22T10:01:00.000Z")).toBe(first);
  expect(
    stampInboxEnabledAt(first, { ...first, inboxInitialHistoryDays: 0 }, "2026-10-22T10:02:00.000Z")
      .inboxEnabledAtByProject,
  ).toEqual(first.inboxEnabledAtByProject);
  const off = stampInboxEnabledAt(
    first,
    { ...first, projectSettingsOverrides: { [ProjectId.make("one")]: { inboxEnabled: false } } },
    "2026-10-22T10:03:00.000Z",
  );
  expect(off.inboxEnabledAtByProject).toEqual({});
  const again = stampInboxEnabledAt(
    off,
    { ...off, projectSettingsOverrides: { [ProjectId.make("one")]: { inboxEnabled: true } } },
    "2026-10-22T10:04:00.000Z",
  );
  expect(again.inboxEnabledAtByProject).toEqual({ one: "2026-10-22T10:04:00.000Z" });
});
