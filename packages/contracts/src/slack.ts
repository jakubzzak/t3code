import * as Schema from "effect/Schema";
import { CommandId, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SlackReadInput = Schema.Struct({
  projectId: ProjectId,
  method: Schema.Literals([
    "auth.test",
    "users.list",
    "users.info",
    "conversations.list",
    "conversations.info",
    "conversations.members",
    "conversations.history",
    "conversations.replies",
    "search.messages",
    "search.files",
    "usergroups.list",
    "files.info",
    "chat.getPermalink",
  ]),
  parameters: Schema.Record(Schema.String, Schema.String),
});
export type SlackReadInput = typeof SlackReadInput.Type;

const slackId = TrimmedNonEmptyString.check(Schema.isPattern(/^[A-Z][A-Z0-9]+$/));
export const SlackSendInput = Schema.Struct({
  projectId: ProjectId,
  commandId: CommandId,
  connectionId: TrimmedNonEmptyString,
  destination: Schema.Union([
    Schema.Struct({ channelId: slackId }),
    Schema.Struct({
      userIds: Schema.Array(slackId).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
    }),
  ]),
  threadTs: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d+\.\d+$/))),
  text: Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(40_000)),
  blocks: Schema.optionalKey(
    Schema.Array(Schema.Record(Schema.String, Schema.Unknown)).check(Schema.isMaxLength(50)),
  ),
});
export type SlackSendInput = typeof SlackSendInput.Type;

export const SlackSendResult = Schema.Struct({
  commandId: CommandId,
  status: Schema.Literals(["pending", "sent", "failed", "uncertain"]),
  channelId: Schema.optionalKey(Schema.String),
  ts: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  retryAfter: Schema.optionalKey(Schema.Number),
});
export type SlackSendResult = typeof SlackSendResult.Type;
