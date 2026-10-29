import type { ScheduledTask } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const local = (value: string | number) =>
  DateTime.setZone(DateTime.makeUnsafe(value), DateTime.zoneMakeLocal());

const dayLabel = (date: DateTime.Zoned, now: DateTime.Zoned) =>
  DateTime.formatLocal(date, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(DateTime.toParts(date).year !== DateTime.toParts(now).year
      ? { year: "numeric" as const }
      : {}),
  });

const timeLabel = (date: DateTime.Zoned) =>
  DateTime.formatLocal(date, { hour: "numeric", minute: "2-digit" });

const isSameDay = (a: DateTime.Zoned, b: DateTime.Zoned) => {
  const x = DateTime.toParts(a);
  const y = DateTime.toParts(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
};

/**
 * Second line for a task row whose last run caught up on missed runs, in the
 * viewer's local time, e.g. "Caught up at 10:27 AM · 11 missed runs since Thu, Oct 15".
 * Null when the last run was not a catch-up, so rows with no missed runs show nothing.
 */
export function formatScheduledTaskCatchUp(
  task: Pick<ScheduledTask, "lastRunAt" | "lastRunStatus" | "lastRunCatchUp">,
  now: number,
): string | null {
  const record = task.lastRunCatchUp;
  if (record === undefined || task.lastRunStatus === "never") return null;
  const current = local(now);
  const missedSince = local(record.missedSince);
  const missed =
    record.missedCount > 1
      ? `${record.missedCount.toLocaleString()} missed runs since ${dayLabel(missedSince, current)}`
      : isSameDay(missedSince, current)
        ? `missed today's ${timeLabel(missedSince)} run`
        : `missed the ${dayLabel(missedSince, current)} run`;
  if (task.lastRunStatus === "running" || task.lastRunAt === null) return `Catching up · ${missed}`;
  const ranAt = local(task.lastRunAt);
  const when = isSameDay(ranAt, current)
    ? `at ${timeLabel(ranAt)}`
    : `${dayLabel(ranAt, current)} at ${timeLabel(ranAt)}`;
  return `${task.lastRunStatus === "failed" ? "Catch-up failed" : "Caught up"} ${when} · ${missed}`;
}
