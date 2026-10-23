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

/** All Inbox timestamps shorten against today in the viewer's local timezone. */
export function formatInboxTimestamp(isoDate: string, nowMs = Date.now()) {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const now = new Date(nowMs);
  return formatDateTime(date, now, !sameDay(date, now));
}

export function formatInboxTimestampTooltip(isoDate: string, nowMs = Date.now()) {
  const date = parseTimestampDate(isoDate);
  return date ? formatDateTime(date, new Date(nowMs), true) : "";
}
