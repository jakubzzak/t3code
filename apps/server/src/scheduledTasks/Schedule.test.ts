import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { countMissedFixedTimeRuns, isSameSchedule, nextScheduledRunAt } from "./Schedule.ts";

const zurich = (day: number, hour: number, minute = 0) =>
  DateTime.makeZonedUnsafe(
    { year: 2026, month: 10, day, hour, minute, second: 0, millisecond: 0 },
    { timeZone: "Europe/Zurich", adjustForTimeZone: true },
  );

describe("countMissedFixedTimeRuns", () => {
  const weekdays = { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] } as const;

  it("counts weekday runs missed over two weeks, including today's passed slot", () => {
    // Thu Oct 15 through Thu Oct 29: 2 + 5 + 4 weekdays.
    expect(countMissedFixedTimeRuns(weekdays, zurich(15, 9), zurich(29, 10, 27))).toBe(11);
  });

  it("does not count today's slot before it passes", () => {
    expect(countMissedFixedTimeRuns(weekdays, zurich(15, 9), zurich(29, 8, 59))).toBe(10);
  });

  it("counts a single missed run", () => {
    expect(countMissedFixedTimeRuns(weekdays, zurich(29, 9), zurich(29, 12))).toBe(1);
  });

  it("counts weekly runs", () => {
    const mondays = { type: "fixed_time", timeOfDay: "09:00", weekdays: [1] } as const;
    expect(countMissedFixedTimeRuns(mondays, zurich(5, 9), zurich(29, 10))).toBe(4);
  });

  it("keeps the local time across a daylight-saving change", () => {
    const daily = { type: "fixed_time", timeOfDay: "09:00" } as const;
    // Europe/Zurich leaves summer time on Sun Oct 25; Oct 24..29 is six runs.
    expect(countMissedFixedTimeRuns(daily, zurich(24, 9), zurich(29, 9))).toBe(6);
  });
});

describe("scheduled task schedule calculation", () => {
  it("skips to the next matching fixed-time weekday", () => {
    const next = nextScheduledRunAt(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      DateTime.makeZonedUnsafe(
        {
          year: 2026,
          month: 7,
          day: 3,
          hour: 10,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        { timeZone: "America/Los_Angeles", adjustForTimeZone: true },
      ),
    );
    const parts = next ? DateTime.toParts(next) : null;
    expect(parts?.weekDay).toBe(1);
    expect(parts?.hour).toBe(9);
    expect(parts?.minute).toBe(0);
  });

  it("compares schedules structurally", () => {
    expect(
      isSameSchedule(
        { type: "once", runAt: "2026-11-01T03:00:00-05:00" },
        { type: "once", runAt: "2026-11-01T08:00:00.000Z" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 60_000 }),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 30_000 }),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [5, 1] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 5, 5] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [] },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3] },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:30" },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "interval", everyMs: 60_000 },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(false);
  });
});
