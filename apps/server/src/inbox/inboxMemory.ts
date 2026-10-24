import type { InboxNotification } from "@t3tools/contracts";
const words = (value: string) =>
  new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
const content = (notification: InboxNotification) =>
  notification.items.map((item) => `${item.title} ${item.content}`).join("\n");
/** A resolved flag or an AI proposal is not evidence that the proposed answer worked. */
export function findInboxPrecedents(
  notification: InboxNotification,
  history: ReadonlyArray<InboxNotification>,
) {
  const query = words(content(notification));
  return history
    .filter(
      (item) =>
        item.projectId === notification.projectId &&
        item.id !== notification.id &&
        item.confirmedOutcome?.trim(),
    )
    .map((item) => ({
      item,
      score: [...words(content(item))].filter((word) => query.has(word)).length,
    }))
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
    .slice(0, 5)
    .map(({ item }) => ({
      id: item.id,
      context: content(item).slice(0, 8000),
      outcome: item.confirmedOutcome!,
    }));
}
