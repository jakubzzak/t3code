import * as Schema from "effect/Schema";
import { ThreadId, ProjectId, CommandId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LinearIssue = Schema.Struct({
  id: TrimmedNonEmptyString,
  identifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  workspace: TrimmedNonEmptyString,
  branchName: TrimmedNonEmptyString,
  // Older linked issues and desktop clients do not carry display metadata.
  priority: Schema.optional(Schema.Literals([0, 1, 2, 3, 4])),
  assignee: Schema.optional(
    Schema.NullOr(Schema.Struct({ name: Schema.String, avatarUrl: Schema.NullOr(Schema.String) })),
  ),
  state: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      color: Schema.String,
      type: Schema.String,
      progress: Schema.Number,
    }),
  ),
});
export type LinearIssue = typeof LinearIssue.Type;

export const LinearConnectionInfo = Schema.Struct({
  canReply: Schema.optionalKey(Schema.Boolean),
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

export const LinearWorkflowState = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.String,
  color: Schema.String,
  type: Schema.String,
  position: Schema.Number,
  team: Schema.Struct({ id: Schema.String, key: Schema.String }),
});
export type LinearWorkflowState = typeof LinearWorkflowState.Type;

export const LinearIssueSort = Schema.Literals(["updatedAt", "priority"]);
export type LinearIssueSort = typeof LinearIssueSort.Type;

export const LinearIssueView = Schema.Literals(["assigned", "triage", "all"]);
export type LinearIssueView = typeof LinearIssueView.Type;
export const LinearConnectionEnvelope = Schema.Struct({
  publicKey: Schema.String.check(Schema.isMaxLength(1000)),
  iv: Schema.String.check(Schema.isMaxLength(100)),
  tag: Schema.String.check(Schema.isMaxLength(100)),
  ciphertext: Schema.String.check(Schema.isMaxLength(32000)),
});
export type LinearConnectionEnvelope = typeof LinearConnectionEnvelope.Type;
export const LinearDesktopRequest = Schema.Struct({
  operation: Schema.Literals([
    "export",
    "status",
    "connect",
    "cancel",
    "disconnect",
    "issues",
    "issue",
    "teams",
    "states",
  ]),
  workspace: TrimmedNonEmptyString,
  connectionKey: TrimmedNonEmptyString,
  migrationPublicKey: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1000))),
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  view: Schema.optional(LinearIssueView),
  teamId: Schema.optional(TrimmedNonEmptyString),
  sort: Schema.optional(LinearIssueSort),
  stateIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  priorities: Schema.optional(Schema.Array(Schema.Literals([0, 1, 2, 3, 4]))),
  issueId: Schema.optional(TrimmedNonEmptyString),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
});
export type LinearDesktopRequest = typeof LinearDesktopRequest.Type;
export const LinearDesktopResult = Schema.Struct({
  migration: Schema.optionalKey(LinearConnectionEnvelope),
  configured: Schema.Boolean,
  connection: Schema.NullOr(LinearConnectionInfo),
  issues: Schema.optional(Schema.Array(LinearIssue)),
  teams: Schema.optional(Schema.Array(LinearTeam)),
  states: Schema.optional(Schema.Array(LinearWorkflowState)),
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

export const LinearEnvironmentKey = Schema.Struct({ projectId: ProjectId });
export const LinearEnvironmentRequest = Schema.Struct({
  ...LinearDesktopRequest.fields,
  projectId: ProjectId,
  operation: Schema.Literals(["status", "issues", "issue", "teams", "states"]),
});
export const LinearMigrationTicket = Schema.Struct({
  ticket: Schema.String,
  publicKey: Schema.String,
});
export const LinearMigrationInput = Schema.Struct({
  projectId: ProjectId,
  ticket: Schema.String,
  envelope: LinearConnectionEnvelope,
});
