import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const InboxSource = Schema.Literals(["slack", "linear", "superhuman"]);
export type InboxSource = typeof InboxSource.Type;
export const InboxPlacement = Schema.Literals(["active", "delegated", "snoozed", "resolved"]);
export type InboxPlacement = typeof InboxPlacement.Type;
export const InboxSlackMention = Schema.Struct({
  kind: Schema.Literals(["user", "group"]),
  id: Schema.String,
  label: Schema.String.check(Schema.isMaxLength(200)),
  personal: Schema.Boolean,
});
export type InboxSlackMention = typeof InboxSlackMention.Type;
const slackPresentation = {
  formattedTitle: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2000))),
  slackMentions: Schema.optionalKey(Schema.Array(InboxSlackMention).check(Schema.isMaxLength(100))),
};
export const InboxSlackMessage = Schema.Struct({
  ...slackPresentation,
  ts: Schema.String,
  author: Schema.String,
  content: Schema.String,
  formattedContent: Schema.String,
  occurredAt: IsoDateTime,
});
export type InboxSlackMessage = typeof InboxSlackMessage.Type;
export const InboxSlackThread = Schema.Struct({
  formatVersion: Schema.optionalKey(Schema.Literal(2)),
  channelId: Schema.String,
  ts: Schema.String,
  root: InboxSlackMessage,
  latestReplyTs: Schema.NullOr(Schema.String),
  replyCount: Schema.NullOr(NonNegativeInt),
  messages: Schema.Array(InboxSlackMessage),
  nextCursor: Schema.NullOr(Schema.String),
});
export type InboxSlackThread = typeof InboxSlackThread.Type;
export const InboxLinearComment = Schema.Struct({
  id: Schema.String,
  author: Schema.String,
  body: Schema.String,
  occurredAt: IsoDateTime,
});
export type InboxLinearComment = typeof InboxLinearComment.Type;
export const InboxLinearIssue = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  comments: Schema.Array(InboxLinearComment),
  commentCount: Schema.optionalKey(NonNegativeInt),
  commentsComplete: Schema.Boolean,
});
export type InboxLinearIssue = typeof InboxLinearIssue.Type;
export const InboxReplyTarget = Schema.Union([
  Schema.Struct({
    source: Schema.Literal("slack"),
    channelId: TrimmedNonEmptyString,
    threadTs: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    source: Schema.Literal("linear"),
    issueId: TrimmedNonEmptyString,
    parentId: Schema.NullOr(TrimmedNonEmptyString),
  }),
]);
export type InboxReplyTarget = typeof InboxReplyTarget.Type;
export const InboxReplyInput = Schema.Struct({
  projectId: ProjectId,
  id: TrimmedNonEmptyString,
  itemId: TrimmedNonEmptyString,
  commandId: CommandId,
  target: InboxReplyTarget,
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
});
export type InboxReplyInput = typeof InboxReplyInput.Type;
export const InboxReplyMessage = Schema.Struct({
  id: TrimmedNonEmptyString,
  author: Schema.String,
  text: Schema.String,
  occurredAt: IsoDateTime,
});
export type InboxReplyMessage = typeof InboxReplyMessage.Type;
export const InboxReplyAttempt = Schema.Struct({
  ...InboxReplyInput.fields,
  status: Schema.Literals(["pending", "sent", "failed", "uncertain"]),
  message: Schema.optionalKey(InboxReplyMessage),
  error: Schema.optionalKey(Schema.String),
});
export type InboxReplyAttempt = typeof InboxReplyAttempt.Type;
export class InboxReplyError extends Schema.TaggedError<InboxReplyError>()("InboxReplyError", {
  reason: Schema.Literals(["permission", "rate-limit", "rejected", "uncertain"]),
  retryAfter: Schema.optionalKey(Schema.Number),
}) {
  override get message() {
    switch (this.reason) {
      case "permission":
        return "Reconnect this source in Settings → Integrations to grant reply permission.";
      case "rate-limit":
        return `Reply rate limit reached. Try again after ${this.retryAfter ?? 60} seconds.`;
      case "rejected":
        return "This conversation cannot accept the reply. Check access in the source application.";
      case "uncertain":
        return "Delivery is uncertain. Check the original conversation before composing another reply. This attempt will not be sent again.";
    }
  }
}
export const InboxSourceItem = Schema.Struct({
  ...slackPresentation,
  replyTarget: Schema.optionalKey(InboxReplyTarget),
  id: TrimmedNonEmptyString,
  source: InboxSource,
  connectionId: TrimmedNonEmptyString,
  groupId: TrimmedNonEmptyString,
  location: Schema.String,
  title: Schema.String,
  author: Schema.String,
  content: Schema.String.check(Schema.isMaxLength(32000)),
  contentFormat: Schema.optionalKey(Schema.Literals(["text"])),
  formattedContent: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(32000))),
  sourceContentHash: Schema.optionalKey(Schema.String),
  slackThread: Schema.optionalKey(InboxSlackThread),
  linearIssue: Schema.optionalKey(InboxLinearIssue),
  url: Schema.String,
  occurredAt: IsoDateTime,
});
export type InboxSourceItem = typeof InboxSourceItem.Type;
export const InboxAnalysisContent = Schema.Struct({
  description: Schema.String.check(Schema.isMaxLength(300)),
  summary: Schema.String.check(Schema.isMaxLength(2000)),
  suggestions: Schema.Array(Schema.String.check(Schema.isMaxLength(4000))).check(
    Schema.isMaxLength(10),
  ),
  precedentIds: Schema.Array(Schema.String).check(Schema.isMaxLength(5)),
});
export type InboxAnalysisContent = typeof InboxAnalysisContent.Type;
export const InboxAnalysis = Schema.Struct({
  replyDraft: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(4000)))),
  description: Schema.String,
  summary: Schema.String,
  suggestions: Schema.Array(Schema.String),
  precedentIds: Schema.Array(Schema.String),
  modelSelection: ModelSelection,
  generatedAt: IsoDateTime,
});
export const InboxResearchStep = Schema.Struct({
  replyDraft: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(4000)))),
  request: Schema.NullOr(
    Schema.Struct({
      tool: Schema.Literals([
        "search_project",
        "read_project_file",
        "search_chats",
        "search_notifications",
        "inspect_links",
      ]),
      query: Schema.String.check(Schema.isMaxLength(200)),
    }),
  ),
  suggestions: Schema.Array(Schema.String.check(Schema.isMaxLength(4000))).check(
    Schema.isMaxLength(10),
  ),
});
export type InboxResearchStep = typeof InboxResearchStep.Type;
export const InboxSuggestionResearch = Schema.Struct({
  status: Schema.Literals(["researching", "ready", "empty", "unavailable"]),
  version: NonNegativeInt,
  attempts: NonNegativeInt,
  retryAt: Schema.NullOr(IsoDateTime),
});
export const InboxState = Schema.Struct({
  read: Schema.Boolean,
  placement: InboxPlacement,
  snoozedUntil: Schema.NullOr(IsoDateTime),
  threadId: Schema.NullOr(ThreadId),
});
export type InboxState = typeof InboxState.Type;
export const InboxNotification = Schema.Struct({
  replyAttempt: Schema.optionalKey(InboxReplyAttempt),
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  source: InboxSource,
  connectionId: TrimmedNonEmptyString,
  groupId: TrimmedNonEmptyString,
  slackThread: Schema.optionalKey(InboxSlackThread),
  linearIssue: Schema.optionalKey(InboxLinearIssue),
  revision: NonNegativeInt,
  state: InboxState,
  items: Schema.Array(InboxSourceItem),
  analysis: Schema.NullOr(InboxAnalysis),
  suggestionResearch: Schema.optionalKey(InboxSuggestionResearch),
  processingError: Schema.NullOr(Schema.String),
  analysisAttempts: Schema.optionalKey(NonNegativeInt),
  analysisRetryAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  analysisVersion: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  agentStatus: Schema.Literals([
    "idle",
    "linking",
    "starting",
    "running",
    "stop-requested",
    "stopped",
    "failed",
  ]),
  agentError: Schema.NullOr(Schema.String),
  agentAttempt: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  agentIntent: Schema.NullOr(Schema.Literals(["chat", "run", "stop"])),
  linkedChatSettled: Schema.Boolean,
  updatedAt: IsoDateTime,
  // Only an explicitly confirmed account of the outcome is precedent, never the resolved flag.
  confirmedOutcome: Schema.NullOr(Schema.String),
});
export type InboxNotification = typeof InboxNotification.Type;
export const InboxListInput = Schema.Struct({
  projectId: ProjectId,
  offset: Schema.optionalKey(NonNegativeInt),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 101 }))),
  search: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  threadId: Schema.optionalKey(ThreadId),
});
export const InboxMutation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("ignore-reply") }),
  Schema.Struct({ type: Schema.Literal("read"), read: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("snooze"), until: Schema.NullOr(IsoDateTime) }),
  Schema.Struct({ type: Schema.Literal("resolve"), resolved: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("delegate"), startAgent: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("undo"), commandId: CommandId }),
  Schema.Struct({ type: Schema.Literal("retry") }),
  Schema.Struct({ type: Schema.Literal("reprocess") }),
  Schema.Struct({ type: Schema.Literal("retry-suggestion") }),
  Schema.Struct({
    type: Schema.Literal("outcome"),
    text: Schema.String.check(Schema.isMaxLength(8000)),
  }),
]);
export type InboxMutation = typeof InboxMutation.Type;
export const InboxMutateInput = Schema.Struct({
  projectId: ProjectId,
  id: TrimmedNonEmptyString,
  commandId: CommandId,
  expectedRevision: NonNegativeInt,
  action: InboxMutation,
});
export type InboxMutateInput = typeof InboxMutateInput.Type;
export const InboxMutationResult = Schema.Struct({
  notification: InboxNotification,
  undoCommandId: Schema.NullOr(CommandId),
  openThread: Schema.Boolean,
});
export type InboxMutationResult = typeof InboxMutationResult.Type;
export class InboxError extends Schema.TaggedError<InboxError>()("InboxError", {
  detail: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message() {
    return this.detail;
  }
}

export const InboxSourceConnection = Schema.Struct({
  canReply: Schema.optionalKey(Schema.Boolean),
  projectId: ProjectId,
  source: InboxSource,
  // Legacy wire compatibility; collection is controlled by the project Inbox feature.
  enabled: Schema.Boolean,
  connected: Schema.Boolean,
  categories: Schema.Array(Schema.String),
  account: Schema.optionalKey(Schema.String),
  /** Legacy wire field; collection now uses the project Inbox history setting. */
  initialLookbackDays: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 90 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(7)),
  ),
  accounts: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  collectionStartedAt: Schema.optionalKey(IsoDateTime),
  collectionHistoryDays: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
  ),
  lastSyncAt: Schema.NullOr(IsoDateTime),
  error: Schema.NullOr(Schema.String),
  retryAt: Schema.NullOr(IsoDateTime),
});
export type InboxSourceConnection = typeof InboxSourceConnection.Type;
export const InboxSourceKey = Schema.Struct({ projectId: ProjectId, source: InboxSource });
export const InboxSourceConfigureInput = Schema.Struct({
  ...InboxSourceKey.fields,
  // Legacy wire compatibility; collection is controlled by the project Inbox feature.
  enabled: Schema.Boolean,
  /** Accepted for older clients, but no longer changes collection history. */
  initialLookbackDays: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 90 })),
  ),
  categories: Schema.Array(Schema.String.check(Schema.isMaxLength(200))).check(
    Schema.isMaxLength(100),
  ),
  accounts: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isMaxLength(320))).check(Schema.isMaxLength(50)),
  ),
  token: Schema.optionalKey(
    Schema.RedactedFromValue(Schema.String.check(Schema.isMaxLength(10000))),
  ),
});
export type InboxSourceConfigureInput = typeof InboxSourceConfigureInput.Type;

export const InboxSourceCatalog = Schema.Struct({
  accounts: Schema.Array(Schema.String),
  splits: Schema.Array(
    Schema.Struct({ accountEmail: Schema.String, id: Schema.String, name: Schema.String }),
  ),
  labels: Schema.Array(Schema.Struct({ accountEmail: Schema.String, name: Schema.String })),
});

export const LINEAR_INBOX_CATEGORIES = [
  "appsAndIntegrations",
  "assignments",
  "billing",
  "commentsAndReplies",
  "customers",
  "documentChanges",
  "feed",
  "loops",
  "mentions",
  "postsAndUpdates",
  "reactions",
  "reminders",
  "reviews",
  "statusChanges",
  "subscriptions",
  "system",
  "triage",
] as const;

export const InboxGetInput = Schema.Struct({
  projectId: ProjectId,
  id: Schema.String,
  loadPreviousComments: Schema.optionalKey(Schema.Boolean),
});
export type InboxGetInput = typeof InboxGetInput.Type;
