import { describe, expect, it } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import { ProjectId } from "@t3tools/contracts";
import { isInboxInitialLoad, isInboxDetailCurrent } from "./inboxPresentation";

describe("Inbox refresh presentation", () => {
  it("shows loading only without cached data, keeping a refreshed empty inbox steady", () => {
    expect(isInboxInitialLoad(AsyncResult.initial(true))).toBe(true);
    expect(isInboxInitialLoad(AsyncResult.success([], { waiting: true }))).toBe(false);
    expect(isInboxInitialLoad(AsyncResult.success([]))).toBe(false);
  });
  const version = {
    id: "notification",
    projectId: ProjectId.make("project"),
    analysisVersion: 1,
    updatedAt: "2026-10-22T10:00:00Z",
    analysis: null,
  };
  it("keeps expanded context when only triage state changes", () => {
    const preview = { ...version, revision: 5 };
    const detail = { ...version, revision: 4 };
    expect(isInboxDetailCurrent(preview, detail)).toBe(true);
  });
  it("rejects detail for changed activity, analysis, or another notification", () => {
    expect(isInboxDetailCurrent(version, { ...version, analysisVersion: 0 })).toBe(false);
    expect(isInboxDetailCurrent(version, { ...version, id: "other" })).toBe(false);
    expect(isInboxDetailCurrent(version, { ...version, updatedAt: "2026-10-21T10:00:00Z" })).toBe(
      false,
    );
    expect(
      isInboxDetailCurrent(version, {
        ...version,
        analysis: { generatedAt: "2026-10-22T11:00:00Z" },
      }),
    ).toBe(false);
    expect(isInboxDetailCurrent(version, null)).toBe(false);
  });
});
