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
export const InboxSlackMessage = Schema.Struct({
  ts: Schema.String,
  author: Schema.String,
  content: Schema.String,
  formattedContent: Schema.String,
  occurredAt: IsoDateTime,
});
export type InboxSlackMessage = typeof InboxSlackMessage.Type;
export const InboxSlackThread = Schema.Struct({
  channelId: Schema.String,
  ts: Schema.String,
  root: InboxSlackMessage,
  latestReplyTs: Schema.NullOr(Schema.String),
  replyCount: Schema.NullOr(NonNegativeInt),
  messages: Schema.Array(InboxSlackMessage),
  nextCursor: Schema.NullOr(Schema.String),
});
export type InboxSlackThread = typeof InboxSlackThread.Type;
export const InboxSourceItem = Schema.Struct({
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
  description: Schema.String,
  summary: Schema.String,
  suggestions: Schema.Array(Schema.String),
  precedentIds: Schema.Array(Schema.String),
  modelSelection: ModelSelection,
  generatedAt: IsoDateTime,
});
export const InboxState = Schema.Struct({
  read: Schema.Boolean,
  placement: InboxPlacement,
  snoozedUntil: Schema.NullOr(IsoDateTime),
  threadId: Schema.NullOr(ThreadId),
});
export type InboxState = typeof InboxState.Type;
export const InboxNotification = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  source: InboxSource,
  connectionId: TrimmedNonEmptyString,
  groupId: TrimmedNonEmptyString,
  slackThread: Schema.optionalKey(InboxSlackThread),
  revision: NonNegativeInt,
  state: InboxState,
  items: Schema.Array(InboxSourceItem),
  analysis: Schema.NullOr(InboxAnalysis),
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
  Schema.Struct({ type: Schema.Literal("read"), read: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("snooze"), until: Schema.NullOr(IsoDateTime) }),
  Schema.Struct({ type: Schema.Literal("resolve"), resolved: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("delegate"), startAgent: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("undo"), commandId: CommandId }),
  Schema.Struct({ type: Schema.Literal("retry") }),
  Schema.Struct({ type: Schema.Literal("reprocess") }),
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
