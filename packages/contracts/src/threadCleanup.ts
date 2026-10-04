import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";

export const ThreadCleanupInput = Schema.Struct({
  threadId: ThreadId,
  interruptAgent: Schema.optionalKey(Schema.Boolean),
});
export type ThreadCleanupInput = typeof ThreadCleanupInput.Type;

export const ThreadCleanupResource = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(["agent", "terminal", "process", "browser", "chat"]),
  status: Schema.Literals(["closing", "closed", "failed"]),
  error: Schema.optionalKey(Schema.String),
});
export type ThreadCleanupResource = typeof ThreadCleanupResource.Type;

export const ThreadCleanupSnapshot = Schema.Struct({
  operationId: Schema.String,
  threadId: ThreadId,
  status: Schema.Literals(["closing", "failed", "complete"]),
  resources: Schema.Array(ThreadCleanupResource),
});
export type ThreadCleanupSnapshot = typeof ThreadCleanupSnapshot.Type;

export class ThreadCleanupError extends Schema.TaggedError<ThreadCleanupError>()(
  "ThreadCleanupError",
  {
    threadId: ThreadId,
    detail: Schema.String,
    confirmationRequired: Schema.optionalKey(Schema.Boolean),
  },
) {
  override get message() {
    return this.detail;
  }
}

/** The OS may hide markers and detached jobs can discard inherited ownership. */
export const THREAD_CLEANUP_OWNERSHIP_NOTICE =
  "Closes managed tools and identifiable child processes. Untracked detached jobs and external browser tabs may remain open.";
