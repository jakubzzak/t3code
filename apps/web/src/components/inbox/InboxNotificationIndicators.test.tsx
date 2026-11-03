// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { ProjectId, type InboxNotification } from "@t3tools/contracts";
import { InboxNotificationIndicators } from "./InboxNotificationIndicators";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.unstubAllGlobals();
});
const notification: InboxNotification = {
  id: "notice",
  projectId: ProjectId.make("project"),
  source: "slack",
  connectionId: "team",
  groupId: "conversation",
  revision: 0,
  state: { read: false, placement: "active", snoozedUntil: null, threadId: null },
  items: [],
  analysis: null,
  analysisVersion: 4,
  processingError: null,
  agentStatus: "idle",
  agentError: null,
  agentAttempt: 0,
  agentIntent: null,
  linkedChatSettled: false,
  confirmedOutcome: null,
  updatedAt: "2026-11-03T12:00:00Z",
};
it.each([
  ["MacIntel", "⌘I"],
  ["Win32", "Ctrl+I"],
])(
  "reveals independent statuses and the %s shortcut through the integration-style tooltip",
  async (platform, shortcut) => {
    vi.stubGlobal("navigator", { platform });
    await act(async () =>
      root.render(
        <InboxNotificationIndicators
          notification={{
            ...notification,
            relevance: {
              version: 4,
              threshold: 98,
              status: "complete",
              confidence: 99,
              irrelevant: true,
            },
            replyCursor: {
              id: "reply",
              occurredAt: notification.updatedAt,
              isSelf: true,
              kind: "reply",
            },
          }}
        />,
      ),
    );
    const irrelevant = container.querySelector<HTMLElement>('[aria-label="Irrelevant"]')!;
    expect(container.querySelector('[aria-label="Unread"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Your last reply"]')).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      irrelevant.focus();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("99% confidence");
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      `${shortcut} · Mark irrelevant`,
    );
    await act(async () =>
      irrelevant.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(irrelevant.hasAttribute("aria-describedby")).toBe(false);
    expect(document.activeElement).toBe(irrelevant);
    await act(async () => irrelevant.click());
    expect(irrelevant.hasAttribute("aria-describedby")).toBe(true);
  },
);
it("does not invent relevance for historical or pending assessments, but supports manual feedback", async () => {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  for (const relevance of [
    undefined,
    { version: 4, threshold: 98, status: "pending" as const, confidence: null, irrelevant: false },
  ]) {
    await act(async () =>
      root.render(
        <InboxNotificationIndicators
          notification={{ ...notification, ...(relevance ? { relevance } : {}) }}
        />,
      ),
    );
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
  }
  await act(async () =>
    root.render(
      <InboxNotificationIndicators
        notification={{ ...notification, state: { ...notification.state, irrelevant: true } }}
      />,
    ),
  );
  const manual = container.querySelector<HTMLElement>('[aria-label="Marked irrelevant by you"]')!;
  await act(async () => manual.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("⌘I · Keep relevant");
});
it("retains the saved decision when a later summary version is requested", async () => {
  await act(async () =>
    root.render(
      <InboxNotificationIndicators
        notification={{
          ...notification,
          relevance: {
            version: 3,
            threshold: 98,
            status: "complete",
            confidence: 91,
            irrelevant: false,
          },
        }}
      />,
    ),
  );
  const possible = container.querySelector<HTMLElement>('[aria-label="Possibly irrelevant"]')!;
  await act(async () => possible.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("91% confidence");
  expect(container.querySelector('[aria-label="Irrelevant"]')).toBeNull();
});
