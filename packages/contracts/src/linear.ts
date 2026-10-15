import * as Schema from "effect/Schema";
import { ThreadId, ProjectId, CommandId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LinearIssue = Schema.Struct({
  id: TrimmedNonEmptyString,
  identifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  workspace: TrimmedNonEmptyString,
  branchName: TrimmedNonEmptyString,
});
export type LinearIssue = typeof LinearIssue.Type;

export const LinearConnectionInfo = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  userId: TrimmedNonEmptyString,
  name: Schema.String,
  email: Schema.String,
});
export type LinearConnectionInfo = typeof LinearConnectionInfo.Type;
export const LinearTeam = Schema.Struct({
  id: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type LinearTeam = typeof LinearTeam.Type;

export const LinearIssueView = Schema.Literals(["assigned", "triage", "all"]);
export type LinearIssueView = typeof LinearIssueView.Type;
export const LinearDesktopRequest = Schema.Struct({
  operation: Schema.Literals([
    "status",
    "connect",
    "cancel",
    "disconnect",
    "issues",
    "issue",
    "teams",
  ]),
  workspace: TrimmedNonEmptyString,
  connectionKey: TrimmedNonEmptyString,
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  view: Schema.optional(LinearIssueView),
  teamId: Schema.optional(TrimmedNonEmptyString),
  issueId: Schema.optional(TrimmedNonEmptyString),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
});
export type LinearDesktopRequest = typeof LinearDesktopRequest.Type;
export const LinearDesktopResult = Schema.Struct({
  configured: Schema.Boolean,
  connection: Schema.NullOr(LinearConnectionInfo),
  issues: Schema.optional(Schema.Array(LinearIssue)),
  teams: Schema.optional(Schema.Array(LinearTeam)),
  nextCursor: Schema.optional(Schema.NullOr(Schema.String)),
});
export type LinearDesktopResult = typeof LinearDesktopResult.Type;

export class LinearIssueSetupError extends Schema.TaggedError<LinearIssueSetupError>()(
  "LinearIssueSetupError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}
export const LinearIssueSetupInput = Schema.Struct({
  commandId: CommandId,
  threadId: ThreadId,
  issue: LinearIssue,
  baseRef: TrimmedNonEmptyString,
  expectedWorktreePath: Schema.NullOr(TrimmedNonEmptyString),
  expectedIssueId: Schema.NullOr(TrimmedNonEmptyString),
  takeoverThreadIds: Schema.Array(ThreadId),
});
export type LinearIssueSetupInput = typeof LinearIssueSetupInput.Type;
export const LinearIssueSetupResult = Schema.Struct({
  status: Schema.Literals(["linked", "conflict"]),
  worktreePath: TrimmedNonEmptyString,
  conflicts: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      projectId: ProjectId,
      title: Schema.String,
      running: Schema.Boolean,
    }),
  ),
});
export type LinearIssueSetupResult = typeof LinearIssueSetupResult.Type;
