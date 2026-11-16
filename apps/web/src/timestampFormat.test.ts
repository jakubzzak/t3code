import { describe, expect, it } from "vite-plus/test";

import {
  formatCompactTimestamp,
  formatDayAwareTimestamp,
  formatUpcomingTimestamp,
} from "./timestampFormat";

describe("formatCompactTimestamp", () => {
  const now = new Date(2026, 9, 22, 12, 0).getTime();
  it("shows hours and minutes today using the selected clock format", () => {
    const timestamp = new Date(2026, 9, 22, 9, 7, 33).toISOString();
    expect(formatCompactTimestamp(timestamp, "24-hour", now)).toBe("09:07");
    expect(formatCompactTimestamp(timestamp, "12-hour", now)).toBe("9:07 AM");
  });
  it("uses a date for previous local calendar days, even across midnight", () => {
    const timestamp = new Date(2026, 9, 21, 23, 59).toISOString();
    expect(
      formatCompactTimestamp(timestamp, "24-hour", new Date(2026, 9, 22, 0, 1).getTime()),
    ).toBe("Oct 21");
  });
  it("includes the year for older years and does not treat a future day as today", () => {
    expect(formatCompactTimestamp(new Date(2025, 9, 22, 9).toISOString(), "24-hour", now)).toBe(
      "Oct 22, 2025",
    );
    expect(formatCompactTimestamp(new Date(2026, 9, 23, 9).toISOString(), "24-hour", now)).toBe(
      "Oct 23",
    );
  });
  it("handles an invalid timestamp without throwing", () => {
    expect(formatCompactTimestamp("invalid", "24-hour", now)).toBe("");
  });
});

describe("timestamps in an explicit time zone", () => {
  // 23:00 UTC on July 1 is 7 PM on July 1 in New York, whatever the host zone.
  const now = Date.parse("2026-07-01T23:00:00.000Z");
  const zone = "America/New_York";

  it("picks relative days from the calendar in that zone", () => {
    expect(formatUpcomingTimestamp("2026-07-02T00:30:00.000Z", "12-hour", now, zone)).not.toMatch(
      /tomorrow/,
    );
    expect(formatUpcomingTimestamp("2026-07-02T05:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^tomorrow at /,
    );
    expect(formatDayAwareTimestamp("2026-07-01T03:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^yesterday at /,
    );
  });
});
