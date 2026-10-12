import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import { ThreadId } from "./baseSchemas.ts";
import { ThreadCleanupSnapshot } from "./threadCleanup.ts";

// The resource schema used by protocol-v2 clients before absent-browser cleanup.
const LegacyThreadCleanupSnapshot = Schema.Struct({
  operationId: Schema.String,
  threadId: ThreadId,
  status: Schema.Literals(["closing", "failed", "complete"]),
  resources: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      kind: Schema.Literals(["agent", "terminal", "process", "browser", "chat"]),
      status: Schema.Literals(["closing", "closed", "failed"]),
      error: Schema.optionalKey(Schema.String),
    }),
  ),
});
const decodeSnapshot = Schema.decodeUnknownSync(ThreadCleanupSnapshot);
const encodeSnapshot = Schema.encodeSync(ThreadCleanupSnapshot);
const decodeLegacySnapshot = Schema.decodeSync(LegacyThreadCleanupSnapshot);

const completed = {
  operationId: "cleanup",
  threadId: "thread",
  status: "complete",
  resources: [
    { id: "browser:tab", label: "http://localhost:3011", kind: "browser", status: "closed" },
  ],
};

it("keeps absent-browser completion readable by older clients", () => {
  const snapshot = decodeSnapshot({
    ...completed,
    resources: [{ ...completed.resources[0], notApplicable: true }],
  });
  expect(snapshot.resources[0]?.notApplicable).toBe(true);
  const wire = encodeSnapshot(snapshot);
  expect(decodeLegacySnapshot(wire)).toEqual(completed);
});

it("reads completion from older servers without not-applicable metadata", () => {
  expect(decodeSnapshot(completed)).toEqual(completed);
});
