import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { formatScheduledTaskCatchUp } from "./scheduledTaskCatchUp.ts";

const local = (day: number, hour: number, minute = 0) =>
  DateTime.makeZonedUnsafe(
    { year: 2026, month: 10, day, hour, minute, second: 0, millisecond: 0 },
    { timeZone: DateTime.zoneMakeLocal(), adjustForTimeZone: true },
  );
const iso = (date: DateTime.DateTime) => DateTime.formatIso(date);
const time = (date: DateTime.DateTime) =>
  DateTime.formatLocal(date, { hour: "numeric", minute: "2-digit" });
const day = (date: DateTime.DateTime) =>
  DateTime.formatLocal(date, { weekday: "short", month: "short", day: "numeric" });

const now = DateTime.toEpochMillis(local(29, 11));
const caughtUpAt = local(29, 10, 27);
const catchUp = (missedSince: DateTime.DateTime, missedCount: number) => ({
  lastRunAt: iso(caughtUpAt),
  lastRunStatus: "succeeded" as const,
  lastRunCatchUp: { missedSince: iso(missedSince), missedCount },
});

describe("formatScheduledTaskCatchUp", () => {
  it("names the catch-up time and how many runs were missed since when", () => {
    expect(formatScheduledTaskCatchUp(catchUp(local(15, 9), 11), now)).toBe(
      `Caught up at ${time(caughtUpAt)} · 11 missed runs since ${day(local(15, 9))}`,
    );
  });

  it("names a single run missed today by its time", () => {
    expect(formatScheduledTaskCatchUp(catchUp(local(29, 9), 1), now)).toBe(
      `Caught up at ${time(caughtUpAt)} · missed today's ${time(local(29, 9))} run`,
    );
  });

  it("names a single run missed on an earlier day by its date", () => {
    expect(formatScheduledTaskCatchUp(catchUp(local(26, 9), 1), now)).toBe(
      `Caught up at ${time(caughtUpAt)} · missed the ${day(local(26, 9))} run`,
    );
  });

  it("dates a catch-up from an earlier day", () => {
    expect(
      formatScheduledTaskCatchUp(catchUp(local(15, 9), 11), DateTime.toEpochMillis(local(30, 8))),
    ).toBe(
      `Caught up ${day(caughtUpAt)} at ${time(caughtUpAt)} · 11 missed runs since ${day(local(15, 9))}`,
    );
  });

  it("reports running and failed catch-ups", () => {
    const record = catchUp(local(15, 9), 11);
    const missed = `11 missed runs since ${day(local(15, 9))}`;
    expect(formatScheduledTaskCatchUp({ ...record, lastRunStatus: "running" }, now)).toBe(
      `Catching up · ${missed}`,
    );
    expect(formatScheduledTaskCatchUp({ ...record, lastRunStatus: "failed" }, now)).toBe(
      `Catch-up failed at ${time(caughtUpAt)} · ${missed}`,
    );
  });

  it("shows nothing when the last run was not a catch-up", () => {
    expect(
      formatScheduledTaskCatchUp({ lastRunAt: iso(caughtUpAt), lastRunStatus: "succeeded" }, now),
    ).toBeNull();
  });
});
