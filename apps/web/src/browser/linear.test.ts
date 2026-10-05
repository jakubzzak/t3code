import { describe, expect, it } from "vite-plus/test";

import { linearInitialUrl } from "./linear";

describe("Linear initial destination", () => {
  it("opens the branch issue in the project's workspace", () => {
    expect(linearInitialUrl("workspace-one", "jakub/eng-123-fix-login")).toBe(
      "https://linear.app/workspace-one/issue/ENG-123",
    );
    expect(linearInitialUrl("workspace-two", "ENG-123-fix")).toBe(
      "https://linear.app/workspace-two/issue/ENG-123",
    );
  });
  it("uses My Issues when the branch has no complete identifier", () => {
    for (const branch of [null, "main", "feature/eng-", "feature/123"]) {
      expect(linearInitialUrl("workspace", branch)).toBe("https://linear.app/workspace/my-issues");
    }
  });
  it("requires a workspace and does not allow URL or path injection", () => {
    for (const workspace of ["", "../other", "https://linear.app/team", "team/issue", "team?x=1"]) {
      expect(linearInitialUrl(workspace, "ENG-123")).toBeNull();
    }
  });
  it("uses the first identifier and accepts punctuation boundaries", () => {
    expect(linearInitialUrl("team", "fix/ENG-123_ENG-456")).toBe(
      "https://linear.app/team/issue/ENG-123",
    );
  });
});
