import { parseTimestampDate } from "~/timestampFormat";

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });

function sameDay(date: Date, reference: Date) {
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

function formatDateTime(date: Date, now: Date, includeDate: boolean) {
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (!includeDate) return time;
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${time} · ${date.getDate()} ${monthFormatter.format(date)}${year}`;
}

/** Thread comments shorten against their notification's day; headers shorten against today. */
export function formatInboxTimestamp(
  isoDate: string,
  referenceTimestamp?: string,
  nowMs = Date.now(),
) {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const now = new Date(nowMs);
  const reference = referenceTimestamp ? (parseTimestampDate(referenceTimestamp) ?? now) : now;
  return formatDateTime(date, now, !sameDay(date, reference));
}

export function formatInboxTimestampTooltip(isoDate: string, nowMs = Date.now()) {
  const date = parseTimestampDate(isoDate);
  return date ? formatDateTime(date, new Date(nowMs), true) : "";
}
