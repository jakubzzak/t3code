import { describe, expect, it } from "vite-plus/test";

import { linearInitialUrl, linearIssueTabLabel } from "./linear";

describe("Linear issue tab labels", () => {
  it("keeps the original matching name, including punctuation and Unicode", () => {
    expect(
      linearIssueTabLabel({
        _tag: "Success",
        url: "https://linear.app/workspace/issue/ENG-123/outdated-slug?comment=123#activity",
        title: "ENG-123 Fix déjà vu · keep - punctuation — unchanged",
      }),
    ).toEqual({
      identifier: "ENG-123",
      name: "Fix déjà vu · keep - punctuation — unchanged",
      shortName: "Fix déjà vu · k..",
      label: "ENG-123 · Fix déjà vu · keep - punctuation — unchanged",
    });
  });

  it.each([
    ["Fix", "Fix"],
    ["Exactly fifteen", "Exactly fifteen"],
    ["Exactly fifteen!", "Exactly fifteen.."],
    ["Fix login redirect on expiry", "Fix login redir.."],
    ["Fix login      redirect", "Fix login.."],
    ["🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀", "🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀.."],
  ])("shows at most 15 characters of the name: %s", (name, shortName) => {
    expect(
      linearIssueTabLabel({
        _tag: "Success",
        url: "https://linear.app/workspace/issue/PLATFORM-123456/slug",
        title: `PLATFORM-123456 ${name}`,
      })?.shortName,
    ).toBe(shortName);
  });

  it.each([
    "",
    "Linear",
    "ENG-123",
    "ENG-12 Old name",
    "ENG-1234 Old name",
    "A title without an ID",
  ])(
    "falls back to the URL identifier when the title cannot identify the same issue: %s",
    (title) => {
      expect(
        linearIssueTabLabel({
          _tag: "Loading",
          url: "https://linear.app/workspace/issue/eng-123/",
          title,
        }),
      ).toEqual({ identifier: "ENG-123", name: "", shortName: "", label: "ENG-123" });
    },
  );

  it.each([
    "https://linear.app/workspace/my-issues",
    "https://linear.app/login",
    "https://accounts.google.com/signin",
    "https://linear.app.evil.test/workspace/issue/ENG-123",
    "http://linear.app/workspace/issue/ENG-123",
    "https://linear.app/workspace/issue/ENG-123/slug/another-route",
    "https://linear.app/workspace/issue/not-an-issue",
    "not a URL",
  ])("does not retain an issue label outside a recognized route: %s", (url) => {
    expect(
      linearIssueTabLabel({ _tag: "Success", url, title: "ENG-123 Fix login redirect" }),
    ).toBeNull();
  });

  it("has no issue label for an idle surface", () => {
    expect(linearIssueTabLabel({ _tag: "Idle" })).toBeNull();
  });
});

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
