import * as Schema from "effect/Schema";
import type {
  InboxSourceItem,
  InboxLinearComment,
  InboxLinearIssue,
  InboxLinearAgentThread,
} from "@t3tools/contracts";
const AgentSessionIdentity = Schema.NullOr(
  Schema.Struct({
    id: Schema.String,
    appUser: Schema.Struct({ id: Schema.String, name: Schema.String }),
  }),
);
const CommentFields = Schema.Struct({
  agentSession: Schema.optionalKey(AgentSessionIdentity),
  parent: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
        agentSession: Schema.optionalKey(AgentSessionIdentity),
      }),
    ),
  ),
  id: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
  user: Schema.NullOr(
    Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      name: Schema.String,
      supportsAgentSessions: Schema.optionalKey(Schema.Boolean),
    }),
  ),
  isArtificialAgentSessionRoot: Schema.optionalKey(Schema.Boolean),
  botActor: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ name: Schema.NullOr(Schema.String) })),
  ),
});
const Comment = Schema.NullOr(CommentFields);
function formatComment(comment: typeof CommentFields.Type): InboxLinearComment {
  const root = comment.parent ?? comment;
  const session = root.agentSession;
  return {
    id: comment.id,
    body: comment.body,
    author: comment.user?.name || comment.botActor?.name || "Linear",
    ...(comment.user?.id ? { authorId: comment.user.id } : {}),
    ...(comment.user?.supportsAgentSessions ||
    (comment.user?.id && comment.user.id === session?.appUser.id)
      ? { authorIsAgent: true }
      : {}),
    ...(session
      ? {
          agentThread: {
            rootCommentId: root.id,
            sessionId: session.id,
            agentId: session.appUser.id,
            agentName: session.appUser.name,
          },
        }
      : {}),
    ...(comment.parent !== undefined ? { parentId: comment.parent?.id ?? null } : {}),
    ...(comment.isArtificialAgentSessionRoot ? { isArtificialAgentSessionRoot: true } : {}),
    occurredAt: comment.createdAt,
  };
}
const commentFields =
  "id body createdAt user { id name supportsAgentSessions } botActor { name } parent { id agentSession { id appUser { id name } } } agentSession { id appUser { id name } } isArtificialAgentSessionRoot";
/** Non-issue replies belong to their native parent thread, not every discussion on a project. */
function commentTarget(comment: typeof CommentFields.Type) {
  return `comment:${comment.parent?.id ?? comment.id}`;
}
const CommentIndex = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      isArtificialAgentSessionRoot: Schema.optionalKey(Schema.Boolean),
    }),
  ),
  pageInfo: Schema.Struct({
    hasNextPage: Schema.Boolean,
    endCursor: Schema.NullOr(Schema.String),
  }),
});
const commentPreviewFields = `latestComments: comments(last: 1, orderBy: createdAt) { nodes { ${commentFields} } }
  commentIndex: comments(first: 50, orderBy: createdAt) { nodes { id isArtificialAgentSessionRoot } pageInfo { hasNextPage endCursor } }`;
const commentPreview = {
  latestComments: Schema.optionalKey(Schema.Struct({ nodes: Schema.Array(CommentFields) })),
  commentIndex: Schema.optionalKey(CommentIndex),
};
const decodeCommentIndex = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({
      issue: Schema.NullOr(Schema.Struct({ id: Schema.String, commentIndex: CommentIndex })),
    }),
  }),
);
const COMMENT_COUNT_QUERY = `query BlackbirdInboxCommentCount($id: String!, $after: String) {
  issue(id: $id) { id commentIndex: comments(first: 50, after: $after, orderBy: createdAt) {
    nodes { id isArtificialAgentSessionRoot } pageInfo { hasNextPage endCursor }
  } }
}`;
/** Linear exposes no issue comment total; count IDs without downloading earlier bodies. */
async function countComments(
  id: string,
  first: typeof CommentIndex.Type | undefined,
  query: (after: string) => Promise<unknown>,
) {
  if (!first) return undefined;
  const ids = new Set(first.nodes.map((comment) => comment.id));
  const hidden = new Set(
    first.nodes
      .filter((comment) => comment.isArtificialAgentSessionRoot)
      .map((comment) => comment.id),
  );
  const seen = new Set<string>();
  let page = first;
  while (page.pageInfo.hasNextPage) {
    const after = page.pageInfo.endCursor;
    if (!after || seen.has(after) || seen.size >= 100)
      throw new Error("Linear comment count could not be paginated.");
    seen.add(after);
    const issue = decodeCommentIndex(await query(after)).data.issue;
    if (!issue || issue.id !== id)
      throw new Error("Linear did not return the issue comment count.");
    page = issue.commentIndex;
    for (const comment of page.nodes) {
      ids.add(comment.id);
      if (comment.isArtificialAgentSessionRoot) hidden.add(comment.id);
    }
  }
  return { count: ids.size, hiddenCommentCount: hidden.size };
}
const Notification = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  category: Schema.String,
  title: Schema.String,
  subtitle: Schema.String,
  url: Schema.String,
  groupingKey: Schema.String,
  createdAt: Schema.String,
  actor: Schema.NullOr(
    Schema.Struct({ id: Schema.optionalKey(Schema.String), name: Schema.String }),
  ),
  issue: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      identifier: Schema.String,
      title: Schema.String,
      description: Schema.NullOr(Schema.String),
      ...commentPreview,
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
export const LINEAR_INBOX_QUERY = `query BlackbirdInbox($after: String, $since: DateTimeOrDuration!, $notificationIds: [ID!]!) {
  viewer { id } organization { id }
  notifications(first: 50, after: $after, orderBy: updatedAt, filter: { or: [{ createdAt: { gte: $since } }, { id: { in: $notificationIds } }] }) {
    nodes { id type category title subtitle url groupingKey createdAt actor { id name }
      ... on IssueNotification { issue { id identifier title description ${commentPreviewFields} } comment { ${commentFields} } parentComment { ${commentFields} } }
      ... on ProjectNotification { project { id name description } comment { ${commentFields} } parentComment { ${commentFields} } }
      ... on InitiativeNotification { comment { ${commentFields} } parentComment { ${commentFields} } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
/** Every notification subtype is retained; issue comments are only one member of the inbox. */
export async function readLinearInbox(
  query: (
    query: string,
    variables: {
      after: string | null;
      since: string;
      id?: string;
      notificationIds?: string[];
      issueIds?: string[];
      commentIds?: string[];
    },
  ) => Promise<unknown>,
  categories: ReadonlyArray<string>,
  since: string,
  tracked: ReadonlyArray<
    Pick<InboxSourceItem, "connectionId" | "groupId" | "linearCommentTarget">
  > = [],
): Promise<ReadonlyArray<InboxSourceItem>> {
  const items: InboxSourceItem[] = [];
  const seen = new Set<string>();
  const issueCounts = new Map<string, Awaited<ReturnType<typeof countComments>>>();
  let after: string | null = null;
  // Pre-upgrade non-issue items retained the notification ID, but not the comment root.
  const resolvedTargets = new Map<string, string>();
  const notificationIds = tracked.flatMap((entry) =>
    entry.linearCommentTarget?.startsWith("notification:")
      ? [entry.linearCommentTarget.slice("notification:".length)]
      : [],
  );
  let viewer = "";
  let connectionId = "";
  do {
    const page = decodePage(await query(LINEAR_INBOX_QUERY, { after, since, notificationIds }));
    viewer = page.data.viewer.id;
    connectionId = `${page.data.organization.id}:${viewer}`;
    for (const notification of page.data.notifications.nodes) {
      if (notification.comment && !notification.issue)
        resolvedTargets.set(`notification:${notification.id}`, commentTarget(notification.comment));
      if (Date.parse(notification.createdAt) < Date.parse(since)) continue;
      if (
        categories.length &&
        !categories.includes("all") &&
        !categories.includes(notification.category)
      )
        continue;
      const issue = notification.issue;
      if (issue && !issueCounts.has(issue.id))
        issueCounts.set(
          issue.id,
          await countComments(issue.id, issue.commentIndex, (after) =>
            query(COMMENT_COUNT_QUERY, { id: issue.id, after, since }),
          ),
        );
      const counts = issue ? issueCounts.get(issue.id) : undefined;
      const commentCount = counts?.count;
      const comments = [
        ...new Map(
          [
            notification.parentComment,
            notification.comment,
            ...(issue?.latestComments?.nodes ?? []),
          ]
            .filter((comment) => comment != null)
            .map((comment) => [comment.id, formatComment(comment)]),
        ).values(),
      ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
      const context = [
        ...comments.toReversed().map((comment) => comment.body),
        notification.title,
        notification.subtitle,
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
        ...(!issue && notification.comment
          ? { linearCommentTarget: commentTarget(notification.comment) }
          : {}),
        ...(notification.issue
          ? {
              replyTarget: {
                source: "linear" as const,
                issueId: notification.issue.id,
                parentId:
                  notification.parentComment?.id ??
                  notification.comment?.parent?.id ??
                  notification.comment?.id ??
                  null,
              },
              linearIssue: {
                commentMetadataVersion: 1,
                agentMetadataVersion: 1,
                id: notification.issue.id,
                title: notification.issue.title,
                description: notification.issue.description,
                comments,
                ...(commentCount !== undefined ? { commentCount } : {}),
                ...(counts?.hiddenCommentCount
                  ? { hiddenCommentCount: counts.hiddenCommentCount }
                  : {}),
                commentsComplete: commentCount !== undefined && commentCount === comments.length,
              },
            }
          : {}),
        url: notification.url,
        occurredAt: notification.createdAt,
        ...(notification.comment
          ? {
              replyActivity: [notification.comment, ...(issue?.latestComments?.nodes ?? [])]
                .filter((comment) => Date.parse(comment.createdAt) >= Date.parse(since))
                .map((comment) => ({
                  id: comment.id,
                  occurredAt: comment.createdAt,
                  isSelf: comment.user?.id === viewer,
                })),
            }
          : notification.actor?.id
            ? {
                replyActivity: [
                  {
                    id: notification.id,
                    occurredAt: notification.createdAt,
                    isSelf: notification.actor.id === viewer,
                    kind: "update" as const,
                  },
                  ...(issue?.latestComments?.nodes ?? [])
                    .filter(
                      (comment) =>
                        Date.parse(comment.createdAt) > Date.parse(notification.createdAt),
                    )
                    .map((comment) => ({
                      id: comment.id,
                      occurredAt: comment.createdAt,
                      isSelf: comment.user?.id === viewer,
                    })),
                ],
              }
            : {}),
      });
    }
    after = page.data.notifications.pageInfo.hasNextPage
      ? page.data.notifications.pageInfo.endCursor
      : null;
    if (after && seen.has(after))
      throw new Error("Linear returned a repeated notification cursor.");
    if (after) seen.add(after);
  } while (after);
  const conversations = [
    ...tracked,
    ...items.filter((item) => item.linearIssue || item.linearCommentTarget),
  ]
    .filter((entry) => entry.connectionId === connectionId)
    .flatMap((entry) => {
      if (!entry.linearCommentTarget?.startsWith("notification:")) return [entry];
      const target = resolvedTargets.get(entry.linearCommentTarget);
      return target ? [{ ...entry, linearCommentTarget: target }] : [];
    });
  const targets = [
    ...new Set(conversations.map((entry) => entry.linearCommentTarget ?? `issue:${entry.groupId}`)),
  ];
  for (let start = 0; start < targets.length; start += 50) {
    const batch = targets.slice(start, start + 50);
    const ids = (kind: string) =>
      batch
        .filter((target) => target.startsWith(`${kind}:`))
        .map((target) => target.slice(kind.length + 1));
    let after: string | null = null;
    const cursors = new Set<string>();
    do {
      const response: unknown = await query(LINEAR_REPLIES_QUERY, {
        since,
        after,
        issueIds: ids("issue"),
        commentIds: ids("comment"),
      });
      const page = decodeReplies(response).data.comments;
      for (const comment of page.nodes) {
        if (Date.parse(comment.createdAt) < Date.parse(since)) continue;
        const target = comment.issue ? `issue:${comment.issue.id}` : commentTarget(comment);
        if (!batch.includes(target)) continue;
        for (const groupId of new Set(
          conversations
            .filter((entry) => (entry.linearCommentTarget ?? `issue:${entry.groupId}`) === target)
            .map((entry) => entry.groupId),
        )) {
          items.push({
            id: `comment:${comment.id}`,
            source: "linear",
            connectionId,
            groupId,
            location: comment.issue?.identifier ?? "Linear comment",
            title: comment.issue?.title ?? "New comment",
            author: comment.user?.name || comment.botActor?.name || "Linear",
            content: [comment.body, comment.issue?.description]
              .filter(Boolean)
              .join("\n\n")
              .slice(0, 32000),
            url: comment.url ?? comment.issue?.url ?? "https://linear.app",
            occurredAt: comment.createdAt,
            ...(comment.issue
              ? {
                  replyTarget: {
                    source: "linear" as const,
                    issueId: comment.issue.id,
                    parentId: comment.parent?.id ?? comment.id,
                  },
                  linearIssue: {
                    commentMetadataVersion: 1,
                    agentMetadataVersion: 1,
                    id: comment.issue.id,
                    title: comment.issue.title,
                    description: comment.issue.description,
                    comments: [formatComment(comment)],
                    commentsComplete: false,
                  },
                }
              : { linearCommentTarget: target }),
            replyActivity: [
              {
                id: comment.id,
                occurredAt: comment.createdAt,
                isSelf: comment.user?.id === viewer,
              },
            ],
          });
        }
      }
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      if (
        (page.pageInfo.hasNextPage && !after) ||
        (after && (cursors.has(after) || cursors.size >= 100))
      )
        throw new Error("Linear returned incomplete or repeated reply history. Try syncing again.");
      if (after) cursors.add(after);
    } while (after);
  }
  return items;
}

const decodeReplies = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({
      comments: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            ...CommentFields.fields,
            url: Schema.optionalKey(Schema.String),
            issue: Schema.NullOr(
              Schema.Struct({
                id: Schema.String,
                identifier: Schema.String,
                title: Schema.String,
                description: Schema.NullOr(Schema.String),
                url: Schema.String,
              }),
            ),
          }),
        ),
        pageInfo: Schema.Struct({
          hasNextPage: Schema.Boolean,
          endCursor: Schema.NullOr(Schema.String),
        }),
      }),
    }),
  }),
);
const LINEAR_REPLIES_QUERY = `query BlackbirdInboxReplies($issueIds: [ID!]!, $commentIds: [ID!]!, $since: DateTimeOrDuration!, $after: String) {
  comments(first: 50, after: $after, orderBy: createdAt, filter: { or: [{ issue: { id: { in: $issueIds } } }, { parent: { id: { in: $commentIds } } }, { id: { in: $commentIds } }], createdAt: { gte: $since } }) {
    nodes { ${commentFields} url issue { id identifier title description url } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const IssuePage = Schema.Struct({
  data: Schema.Struct({
    issue: Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        description: Schema.NullOr(Schema.String),
        ...commentPreview,
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

/** The latest comment and lightweight count are available before Show all downloads bodies. */
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
      issue(id: $id) { id title description ${includeComments ? `comments(first: 50, after: $after, orderBy: createdAt) { nodes { ${commentFields} } pageInfo { hasNextPage endCursor } }` : commentPreviewFields} }
    }`,
        { id, after },
      ),
    );
    const issue = page.data.issue;
    if (!issue) return null;
    if (issue.id !== id) throw new Error("Linear returned a different issue.");
    for (const comment of issue.comments?.nodes ?? issue.latestComments?.nodes ?? [])
      comments.set(comment.id, formatComment(comment));
    const counts = includeComments
      ? undefined
      : await countComments(id, issue.commentIndex, (after) =>
          query(COMMENT_COUNT_QUERY, { id, after }),
        );
    const commentCount = counts?.count;
    result = {
      commentMetadataVersion: 1,
      agentMetadataVersion: 1,
      id: issue.id,
      title: issue.title,
      description: issue.description,
      comments: [...comments.values()].sort(
        (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
      ),
      ...(commentCount !== undefined ? { commentCount } : {}),
      ...(counts?.hiddenCommentCount ? { hiddenCommentCount: counts.hiddenCommentCount } : {}),
      commentsComplete: includeComments || commentCount === comments.size,
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
  if (!result || !includeComments) return result;
  const hiddenCommentCount = [...comments.values()].filter(
    (comment) => comment.isArtificialAgentSessionRoot,
  ).length;
  return {
    ...result,
    commentCount: comments.size,
    ...(hiddenCommentCount ? { hiddenCommentCount } : {}),
  };
}

const AgentSession = Schema.NullOr(
  Schema.Struct({
    id: Schema.String,
    status: Schema.String,
    appUser: Schema.Struct({ id: Schema.String, name: Schema.String }),
  }),
);
const decodeAgentThread = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({
      comment: Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
          agentSession: AgentSession,
          parent: Schema.optionalKey(
            Schema.NullOr(Schema.Struct({ id: Schema.String, agentSession: AgentSession })),
          ),
        }),
      ),
    }),
  }),
);

/** Read only the notification's own root; an agent elsewhere on the issue is unrelated. */
export async function readLinearAgentThread(
  query: (query: string, variables: { id: string }) => Promise<unknown>,
  rootCommentId: string,
): Promise<InboxLinearAgentThread | null> {
  const { comment } = decodeAgentThread(
    await query(
      `query BlackbirdInboxAgentThread($id: String!) {
    comment(id: $id) { id agentSession { id status appUser { id name } } parent { id agentSession { id status appUser { id name } } } }
  }`,
      { id: rootCommentId },
    ),
  ).data;
  if (!comment) return null;
  if (comment.id !== rootCommentId) throw new Error("Linear returned a different comment thread.");
  const root = comment.parent ?? comment;
  const session = root.agentSession;
  return session
    ? {
        commentId: rootCommentId,
        rootCommentId: root.id,
        sessionId: session.id,
        agentId: session.appUser.id,
        agentName: session.appUser.name,
        status: session.status,
      }
    : null;
}
