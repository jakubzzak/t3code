import * as Schema from "effect/Schema";
import type { InboxSourceItem } from "@t3tools/contracts";
const Comment = Schema.NullOr(Schema.Struct({ body: Schema.String }));
const Notification = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  category: Schema.String,
  title: Schema.String,
  subtitle: Schema.String,
  url: Schema.String,
  groupingKey: Schema.String,
  createdAt: Schema.String,
  actor: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  issue: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      identifier: Schema.String,
      title: Schema.String,
      description: Schema.NullOr(Schema.String),
    }),
  ),
  comment: Schema.optionalKey(Comment),
  parentComment: Schema.optionalKey(Comment),
  project: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.NullOr(Schema.String),
    }),
  ),
});
const Page = Schema.Struct({
  data: Schema.Struct({
    viewer: Schema.Struct({ id: Schema.String }),
    organization: Schema.Struct({ id: Schema.String }),
    notifications: Schema.Struct({
      nodes: Schema.Array(Notification),
      pageInfo: Schema.Struct({
        hasNextPage: Schema.Boolean,
        endCursor: Schema.NullOr(Schema.String),
      }),
    }),
  }),
});
const decodePage = Schema.decodeUnknownSync(Page);
export const LINEAR_INBOX_QUERY = `query BlackbirdInbox($after: String) {
  viewer { id } organization { id }
  notifications(first: 50, after: $after, orderBy: updatedAt) {
    nodes { id type category title subtitle url groupingKey createdAt actor { name }
      ... on IssueNotification { issue { id identifier title description } comment { body } parentComment { body } }
      ... on ProjectNotification { project { id name description } comment { body } parentComment { body } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
/** Every notification subtype is retained; issue comments are only one member of the inbox. */
export async function readLinearInbox(
  query: (query: string, variables: { after: string | null }) => Promise<unknown>,
  categories: ReadonlyArray<string>,
): Promise<ReadonlyArray<InboxSourceItem>> {
  const items: InboxSourceItem[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  do {
    const page = decodePage(await query(LINEAR_INBOX_QUERY, { after }));
    for (const notification of page.data.notifications.nodes) {
      if (
        categories.length &&
        !categories.includes("all") &&
        !categories.includes(notification.category)
      )
        continue;
      const context = [
        notification.title,
        notification.subtitle,
        notification.parentComment?.body,
        notification.comment?.body,
        notification.issue?.description,
        notification.project?.description,
      ]
        .filter(Boolean)
        .join("\n\n");
      items.push({
        id: notification.id,
        source: "linear",
        connectionId: `${page.data.organization.id}:${page.data.viewer.id}`,
        groupId: notification.issue?.id ?? notification.groupingKey ?? notification.id,
        location:
          notification.issue?.identifier ?? notification.project?.name ?? notification.subtitle,
        title: notification.title,
        author: notification.actor?.name ?? "Linear",
        content: context.slice(0, 32000),
        url: notification.url,
        occurredAt: notification.createdAt,
      });
    }
    after = page.data.notifications.pageInfo.hasNextPage
      ? page.data.notifications.pageInfo.endCursor
      : null;
    if (after && seen.has(after))
      throw new Error("Linear returned a repeated notification cursor.");
    if (after) seen.add(after);
  } while (after);
  return items;
}
