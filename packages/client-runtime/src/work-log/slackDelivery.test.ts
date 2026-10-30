import { describe, expect, it } from "vite-plus/test";
import { compactDynamicToolOutput } from "@t3tools/shared/toolOutput";
import {
  resolveWorkEntryToolPresentation,
  summarizeToolGroup,
  workEntryIndicatesToolSuccess,
  type WorkLogPresentationEntry,
} from "./presentation.ts";

const entry = (output: unknown, id = "call"): WorkLogPresentationEntry => ({
  id,
  createdAt: "2026-10-30T12:00:00.000Z",
  label: "MCP tool call",
  itemType: "dynamic_tool",
  toolLifecycleStatus: "completed",
  tone: "tool",
  toolData: { toolName: "mcp__t3_code__slack_send", output },
});
const receipt = (status: string, commandId = "send-1") => ({
  commandId,
  status,
  ...(status === "sent" ? { channelId: "D1", ts: "1793260900.000001" } : {}),
  ...(status === "uncertain" || status === "failed" ? { error: "Private details" } : {}),
});

// Exercise the wire shape as well as the envelopes kept by provider adapters.
const envelopes = [
  (data: unknown) => data,
  (data: unknown) => ({ structuredContent: data }),
  (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }] }),
  (data: unknown) => compactDynamicToolOutput({ structuredContent: data }),
];

describe("Slack delivery presentation", () => {
  it.each([
    ["pending", "Slack message delivery pending", false],
    ["uncertain", "Slack message delivery uncertain", false],
    ["failed", "Failed to send a Slack message", false],
    ["sent", "Sent a Slack message", true],
  ] as const)(
    "shows %s without confusing tool completion with delivery",
    (status, label, success) => {
      for (const envelope of envelopes) {
        const call = entry(envelope(receipt(status)));
        expect(resolveWorkEntryToolPresentation(call)?.displayName).toBe(label);
        expect(workEntryIndicatesToolSuccess(call)).toBe(success);
      }
    },
  );

  it("does not infer delivery from legacy output or a running tool call", () => {
    const unknown = entry(undefined);
    expect(resolveWorkEntryToolPresentation(unknown)?.displayName).toBe(
      "Checked Slack message delivery",
    );
    expect(workEntryIndicatesToolSuccess(unknown)).toBe(false);
    expect(
      resolveWorkEntryToolPresentation({ ...unknown, toolLifecycleStatus: "inProgress" })
        ?.displayName,
    ).toBe("Sending a Slack message");
  });

  it("counts one confirmed message across replayed receipts and stale pending checks", () => {
    const calls = ["pending", "sent", "sent", "pending"].map((status, index) =>
      entry(compactDynamicToolOutput(receipt(status)), `call-${index}`),
    );
    expect(summarizeToolGroup(calls)).toEqual({
      summary: "Sent 1 Slack message",
      hasFailure: false,
    });
  });

  it("keeps mixed delivery outcomes distinct and deduplicates each command", () => {
    const states = ["sent", "pending", "uncertain", "failed"];
    const calls = states.flatMap((status, index) => {
      const output = compactDynamicToolOutput(receipt(status, `send-${index}`));
      return [entry(output, `${index}-a`), entry(output, `${index}-b`)];
    });
    expect(summarizeToolGroup(calls)).toEqual({
      summary: "Sent 1 Slack message; 1 pending; 1 uncertain; 1 failed",
      hasFailure: true,
    });
  });

  it.each([
    ["pending", "1 Slack message pending"],
    ["uncertain", "1 Slack message uncertain"],
    ["failed", "1 Slack message failed"],
  ])("does not claim delivery for an all-%s group", (status, summary) => {
    expect(summarizeToolGroup([entry(compactDynamicToolOutput(receipt(status)))])).toEqual({
      summary,
      hasFailure: status === "failed",
    });
  });
});
