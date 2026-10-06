import { expect, it } from "vite-plus/test";
import { EventId, MessageId, ThreadId } from "@t3tools/contracts";
import { isThreadDetailEvent } from "./ws.ts";

it("routes language edits to thread subscribers instead of the shell stream", () => {
  const threadId = ThreadId.make("diagram-thread");
  expect(
    isThreadDetailEvent({
      sequence: 1,
      eventId: EventId.make("language-edit"),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      occurredAt: "2026-10-06T12:00:00.000Z",
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.message-code-language-set",
      payload: {
        threadId,
        messageId: MessageId.make("diagram"),
        text: "```mermaid\nflowchart LR\nA-->B\n```",
        updatedAt: "2026-10-06T12:00:00.000Z",
      },
    }),
  ).toBe(true);
});
