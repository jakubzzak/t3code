import { describe, expect, it } from "vite-plus/test";
import { ProjectId, type InboxSourceConnection } from "@t3tools/contracts";
import { inboxIntegrationStatus } from "./integrationStatusPresentation";

const now = Date.parse("2026-11-01T12:00:00Z");
function failed(
  minutes: number,
  overrides: Partial<InboxSourceConnection> = {},
): InboxSourceConnection {
  return {
    projectId: ProjectId.make("demo"),
    source: "slack",
    enabled: true,
    connected: true,
    categories: [],
    accounts: [],
    initialLookbackDays: 7,
    lastSyncAt: new Date(now - minutes * 60_000).toISOString(),
    error: "raw diagnostic",
    retryAt: null,
    ...overrides,
  };
}

describe("inbox integration status", () => {
  it.each([0, 14, 30])("stays yellow at %i minutes", (minutes) => {
    expect(inboxIntegrationStatus([failed(minutes)], now)?.color).toBe("hsl(58 90% 65%)");
  });
  it.each([120, 121, 240])("stays red at %i minutes", (minutes) => {
    expect(inboxIntegrationStatus([failed(minutes)], now)?.color).toBe("hsl(0 90% 65%)");
  });
  it("passes continuously through orange, independent of retry deadlines", () => {
    const status = inboxIntegrationStatus(
      [failed(75, { retryAt: new Date(now + 60_000).toISOString() })],
      now,
    )!;
    expect(status.color).toBe("hsl(29 90% 65%)");
    expect(status.lines).toEqual(["Slack updates delayed · Last synced 1h 15m ago"]);
    const before = inboxIntegrationStatus([failed(74)], now)!;
    const after = inboxIntegrationStatus([failed(76)], now)!;
    expect(before.color).not.toBe(status.color);
    expect(after.color).not.toBe(status.color);
  });
  it("combines duplicate sources across projects using their oldest failed sync", () => {
    const connection = failed(14);
    const result = inboxIntegrationStatus(
      [
        connection,
        connection,
        failed(121, { projectId: ProjectId.make("other") }),
        failed(75, { source: "linear" }),
        failed(10, { source: "superhuman" }),
        failed(999, { source: "linear", error: null }),
      ],
      now,
    )!;
    expect(result.color).toBe("hsl(0 90% 65%)");
    expect(result.lines).toEqual([
      "Slack updates delayed · Last synced 2h 1m ago",
      "Superhuman updates delayed · Last synced 10m ago",
      "Linear updates delayed · Last synced 1h 15m ago",
    ]);
  });
  it("clears on recovery, disabling, or removal from scope", () => {
    expect(inboxIntegrationStatus([failed(180, { error: null })], now)).toBeNull();
    expect(inboxIntegrationStatus([failed(180, { enabled: false })], now)).toBeNull();
    expect(inboxIntegrationStatus([], now)).toBeNull();
  });
  it("does not invent a successful sync and uses collection start only for severity", () => {
    const result = inboxIntegrationStatus(
      [
        failed(0, {
          lastSyncAt: null,
          collectionStartedAt: new Date(now - 120 * 60_000).toISOString(),
        }),
      ],
      now,
    )!;
    expect(result.lines).toEqual(["Slack updates delayed · Never synced"]);
    expect(result.color).toBe("hsl(0 90% 65%)");
    expect(inboxIntegrationStatus([failed(0, { lastSyncAt: "invalid" })], now)?.color).toBe(
      "hsl(58 90% 65%)",
    );
    expect(inboxIntegrationStatus([failed(-10)], now)?.lines).toEqual([
      "Slack updates delayed · Last synced just now",
    ]);
  });
});
