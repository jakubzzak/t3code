import * as Schema from "effect/Schema";
import type { InboxSourceItem, InboxLinearComment, InboxLinearIssue } from "@t3tools/contracts";
const CommentFields = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
  user: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  botActor: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ name: Schema.NullOr(Schema.String) })),
  ),
});
const Comment = Schema.NullOr(CommentFields);
function formatComment(comment: typeof CommentFields.Type): InboxLinearComment {
  return {
    id: comment.id,
    body: comment.body,
    author: comment.user?.name || comment.botActor?.name || "Linear",
    occurredAt: comment.createdAt,
  };
}
const commentFields = "id body createdAt user { name } botActor { name }";
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
export const LINEAR_INBOX_QUERY = `query BlackbirdInbox($after: String, $since: DateTimeOrDuration!) {
  viewer { id } organization { id }
  notifications(first: 50, after: $after, orderBy: updatedAt, filter: { createdAt: { gte: $since } }) {
    nodes { id type category title subtitle url groupingKey createdAt actor { name }
      ... on IssueNotification { issue { id identifier title description } comment { ${commentFields} } parentComment { ${commentFields} } }
      ... on ProjectNotification { project { id name description } comment { ${commentFields} } parentComment { ${commentFields} } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
/** Every notification subtype is retained; issue comments are only one member of the inbox. */
export async function readLinearInbox(
  query: (query: string, variables: { after: string | null; since: string }) => Promise<unknown>,
  categories: ReadonlyArray<string>,
  since: string,
): Promise<ReadonlyArray<InboxSourceItem>> {
  const items: InboxSourceItem[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  do {
    const page = decodePage(await query(LINEAR_INBOX_QUERY, { after, since }));
    for (const notification of page.data.notifications.nodes) {
      if (Date.parse(notification.createdAt) < Date.parse(since)) continue;
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
        ...(notification.issue
          ? {
              linearIssue: {
                id: notification.issue.id,
                title: notification.issue.title,
                description: notification.issue.description,
                comments: [
                  ...new Map(
                    [notification.parentComment, notification.comment]
                      .filter((c) => c != null)
                      .map((c) => [c.id, formatComment(c)]),
                  ).values(),
                ],
                commentsComplete: false,
              },
            }
          : {}),
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

const IssuePage = Schema.Struct({
  data: Schema.Struct({
    issue: Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        description: Schema.NullOr(Schema.String),
        comments: Schema.optionalKey(
          Schema.Struct({
            nodes: Schema.Array(CommentFields),
            pageInfo: Schema.Struct({
              hasNextPage: Schema.Boolean,
              endCursor: Schema.NullOr(Schema.String),
            }),
          }),
        ),
      }),
    ),
  }),
});
const decodeIssuePage = Schema.decodeUnknownSync(IssuePage);

/** Issue detail is fetched on demand; history pagination is only requested by Show all. */
export async function readLinearIssue(
  query: (query: string, variables: { id: string; after: string | null }) => Promise<unknown>,
  id: string,
  includeComments: boolean,
): Promise<InboxLinearIssue | null> {
  const comments = new Map<string, InboxLinearComment>();
  const seen = new Set<string>();
  let after: string | null = null;
  let result: InboxLinearIssue | null = null;
  do {
    const page = decodeIssuePage(
      await query(
        `query BlackbirdInboxIssue($id: String!${includeComments ? ", $after: String" : ""}) {
      issue(id: $id) { id title description ${includeComments ? `comments(first: 50, after: $after, orderBy: createdAt) { nodes { ${commentFields} } pageInfo { hasNextPage endCursor } }` : ""} }
    }`,
        { id, after },
      ),
    );
    const issue = page.data.issue;
    if (!issue) return null;
    if (issue.id !== id) throw new Error("Linear returned a different issue.");
    for (const comment of issue.comments?.nodes ?? [])
      comments.set(comment.id, formatComment(comment));
    result = {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      comments: [...comments.values()].sort(
        (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
      ),
      commentsComplete: includeComments,
    };
    after = issue.comments?.pageInfo.hasNextPage ? issue.comments.pageInfo.endCursor : null;
    if (includeComments && !issue.comments)
      throw new Error("Linear did not return the issue comments.");
    if (issue.comments?.pageInfo.hasNextPage && !after)
      throw new Error("Linear returned an incomplete comments page without a cursor.");
    if (after && (seen.has(after) || seen.size >= 100))
      throw new Error("Linear comment history could not be paginated. Open the original issue.");
    if (after) seen.add(after);
  } while (after);
  return result;
}
