import { randomHex } from "~/lib/utils";
import type { LinearIssue, LinearIssueSetupResult } from "@t3tools/contracts";
import { create } from "zustand";
import { installLinearCreationGuest } from "~/browser/linearCreationGuest";
import { previewBridge } from "../preview/previewBridge";

interface Creation {
  status: "pending" | "setting-up" | "ready" | "error";
  conflict?: { issue: LinearIssue; result: LinearIssueSetupResult };
  workspace: string;
  connectionKey: string;
  issue?: LinearIssue;
  issueId?: string;
  error?: string | undefined;
}
export const useLinearCreations = create<{ entries: Record<string, Creation | undefined> }>(() => ({
  entries: {},
}));
export function clearLinearCreation(key: string) {
  useLinearCreations.setState(({ entries }) => {
    const next = { ...entries };
    delete next[key];
    return { entries: next };
  });
}
function put(key: string, entry: Creation) {
  useLinearCreations.setState(({ entries }) => ({ entries: { ...entries, [key]: entry } }));
}
export async function verifyLinearCreation(key: string) {
  const entry = useLinearCreations.getState().entries[key];
  if (!entry?.issueId || !window.desktopBridge?.linearRequest) return;
  try {
    const result = await window.desktopBridge.linearRequest({
      operation: "issue",
      workspace: entry.workspace,
      connectionKey: entry.connectionKey,
      issueId: entry.issueId,
    });
    const issue = result.issues?.[0];
    if (!issue || issue.id !== entry.issueId)
      throw new Error("Unable to verify the created Linear issue.");
    if (useLinearCreations.getState().entries[key] !== entry) return;
    put(key, { ...entry, status: "ready", issue, error: undefined });
    return issue;
  } catch (cause) {
    if (useLinearCreations.getState().entries[key] !== entry) return;
    put(key, {
      ...entry,
      status: "error",
      error: cause instanceof Error ? cause.message : "Unable to verify the created Linear issue.",
    });
  }
}

export async function setupBackgroundLinearCreation(
  key: string,
  issue: LinearIssue,
  setup: () => Promise<LinearIssueSetupResult | null>,
) {
  const entry = useLinearCreations.getState().entries[key];
  if (!entry) return;
  put(key, { ...entry, status: "setting-up" });
  try {
    const result = await setup();
    if (result?.status === "linked") clearLinearCreation(key);
    else
      put(key, {
        ...entry,
        status: "ready",
        ...(result?.status === "conflict" ? { conflict: { issue, result } } : {}),
      });
  } catch (cause) {
    put(key, {
      ...entry,
      status: "ready",
      error:
        cause instanceof Error ? cause.message : "Unable to set up the created issue. Try again.",
    });
  }
}

/** Creation stays bound to its originating chat even when another chat is displayed. */
export async function beginLinearCreation(input: {
  key: string;
  workspace: string;
  connectionKey: string;
  open: () => Promise<string>;
  onCreated: (issue: LinearIssue) => void;
}) {
  if (!previewBridge || useLinearCreations.getState().entries[input.key]?.status === "pending")
    return;
  const entry: Creation = {
    status: "pending",
    workspace: input.workspace,
    connectionKey: input.connectionKey,
  };
  put(input.key, entry);
  let tabId: string | undefined;
  const token = randomHex(16);
  try {
    tabId = await input.open();
    const runtimeTabId = tabId;
    const automation = previewBridge.automation;
    const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 250));
    // Only observation may resume after human input; never replay editor-opening input.
    const observe = async <T>(
      operation: "evaluate" | "waitFor",
      deadline: number,
      read: () => Promise<T>,
    ): Promise<T> => {
      while (Date.now() < deadline) {
        try {
          return await read();
        } catch (cause) {
          // Electron serializes IPC errors into Error.message, losing the tagged type.
          if (
            !(cause instanceof Error) ||
            !cause.message.includes(
              `Preview automation ${operation} was interrupted by human input in tab ${runtimeTabId}`,
            )
          )
            throw cause;
        }
        await pause();
      }
      throw new Error("Linear issue creation timed out. Your issue or draft remains in Linear.");
    };
    const openingDeadline = Date.now() + 60_000;
    // The server session exists before React has attached and registered its native guest.
    while (true) {
      if (Date.now() >= openingDeadline)
        throw new Error(
          "Linear's panel is not ready. Wait for it to load, then try Create issue again.",
        );
      const status = await automation.status(runtimeTabId);
      if (status.available && !status.loading && status.url && status.url !== "about:blank") break;
      await pause();
    }
    await observe("waitFor", openingDeadline, () =>
      automation.waitFor(runtimeTabId, {
        locator: 'button[aria-label="Create new issue"]',
        timeoutMs: Math.max(1, openingDeadline - Date.now()),
      }),
    );
    await previewBridge.automation.evaluate(tabId, {
      expression: `(${installLinearCreationGuest.toString()})(${JSON.stringify(token)},${JSON.stringify(input.workspace)})`,
    });
    await previewBridge.automation.press(tabId, { key: "c" });
    const editorDeadline = Date.now() + 5_000;
    await observe("waitFor", editorDeadline, () =>
      automation.waitFor(runtimeTabId, {
        locator: '[aria-label="Issue title"]',
        timeoutMs: Math.max(1, editorDeadline - Date.now()),
      }),
    );
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const raw = await observe("evaluate", deadline, () =>
        automation.evaluate(runtimeTabId, {
          expression: `(() => { const task = window.__t3LinearCreation; return task?.token === ${JSON.stringify(token)} ? task.result : null; })()`,
        }),
      );
      if (!raw || typeof raw !== "object" || !("status" in raw))
        throw new Error("Linear navigated away from the creation flow. Your chat has not changed.");
      if (raw.status === "cancelled") {
        clearLinearCreation(input.key);
        return;
      }
      if (raw.status === "error")
        throw new Error(
          "message" in raw && typeof raw.message === "string"
            ? raw.message
            : "Linear issue creation failed.",
        );
      if (raw.status === "created" && "issueId" in raw && typeof raw.issueId === "string") {
        put(input.key, { ...entry, issueId: raw.issueId });
        const issue = await verifyLinearCreation(input.key);
        if (issue) input.onCreated(issue);
        return;
      }
      // No background polling outside an explicitly opened, bounded creation flow.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Linear issue creation timed out. Your issue or draft remains in Linear.");
  } catch (cause) {
    put(input.key, {
      ...entry,
      status: "error",
      error: cause instanceof Error ? cause.message : "Unable to open Linear's issue editor.",
    });
  } finally {
    if (tabId)
      void previewBridge.automation
        .evaluate(tabId, {
          expression: `(() => { const task = window.__t3LinearCreation; if (task?.token === ${JSON.stringify(token)}) task.cancel(); })()`,
        })
        .catch(() => {});
  }
}
