import { describe, expect, it } from "vite-plus/test";
import {
  formatInboxSyncTimestamp,
  formatInboxTimestamp,
  formatInboxTimestampTooltip,
} from "./inboxTimestampFormat";

const now = new Date(2026, 9, 23, 18).getTime();
const local = (year: number, month: number, day: number, hour = 10, minute = 52) =>
  new Date(year, month - 1, day, hour, minute).toISOString();

describe("Inbox timestamps", () => {
  it.each([
    [local(2026, 10, 23), "10:52"],
    [local(2026, 10, 23, 14), "14:52"],
    [local(2026, 10, 23, 0, 5), "00:05"],
    [local(2026, 10, 22), "10:52 · 22 Oct"],
    [local(2025, 10, 22, 14), "14:52 · 22 Oct 2025"],
    [local(2027, 1, 1), "10:52 · 1 Jan 2027"],
    [local(2026, 9, 1), "10:52 · 1 Sep"],
  ])("formats %s as %s", (timestamp, expected) => {
    expect(formatInboxTimestamp(timestamp, now)).toBe(expected);
  });

  it("compares local calendar dates rather than elapsed 24-hour periods", () => {
    const justAfterMidnight = new Date(2026, 9, 23, 0, 1).getTime();
    expect(formatInboxTimestamp(local(2026, 10, 22, 23, 59), justAfterMidnight)).toBe(
      "23:59 · 22 Oct",
    );
  });

  it("always includes the date on hover, adding only a different year", () => {
    expect(formatInboxTimestampTooltip(local(2026, 10, 23), now)).toBe("10:52 · 23 Oct");
    expect(formatInboxTimestampTooltip(local(2025, 10, 22, 14), now)).toBe("14:52 · 22 Oct 2025");
  });

  it("handles invalid timestamps without rendering Invalid Date", () => {
    expect(formatInboxTimestamp("invalid", now)).toBe("");
    expect(formatInboxTimestampTooltip("invalid", now)).toBe("");
  });
});

describe("integration sync timestamps", () => {
  it.each([
    [0, "0 minutes ago"],
    [59_999, "0 minutes ago"],
    [60_000, "1 minute ago"],
    [5 * 60_000, "5 minutes ago"],
    [3_599_999, "59 minutes ago"],
    [3_600_000, "17:00"],
    [2 * 3_600_000, "16:00"],
    [-60_000, "18:01"],
  ])("formats elapsed %s ms as %s", (elapsed, expected) => {
    expect(formatInboxSyncTimestamp(new Date(now - elapsed).toISOString(), now)).toBe(expected);
  });
  it("uses the notification date/year rules for older syncs", () => {
    expect(formatInboxSyncTimestamp(local(2026, 10, 22), now)).toBe("10:52 · 22 Oct");
    expect(formatInboxSyncTimestamp(local(2025, 10, 22), now)).toBe("10:52 · 22 Oct 2025");
    expect(formatInboxSyncTimestamp("invalid", now)).toBe("");
  });
});
