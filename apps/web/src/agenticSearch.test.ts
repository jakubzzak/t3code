import { describe, expect, it } from "vite-plus/test";
import { prepareAgenticSearchPrompt, type AgenticSearchDraft } from "./agenticSearch";

const search: AgenticSearchDraft = {
  scope: "chats",
  template: "Find evidence and cite it.",
  presentation: "implicit",
  autoSubmit: false,
};

describe("search prompt submission", () => {
  it("combines an implicit template with the user's exact question", () => {
    expect(prepareAgenticSearchPrompt(search, "Where is the Oct 23 decision?")).toBe(
      "Find evidence and cite it.\n\nQuestion:\nWhere is the Oct 23 decision?",
    );
  });
  it("does not submit a template or whitespace without a question", () => {
    expect(prepareAgenticSearchPrompt(search, "  ")).toBeNull();
    expect(
      prepareAgenticSearchPrompt(
        { ...search, presentation: "explicit" },
        `${search.template}\n\nQuestion:\n   `,
      ),
    ).toBeNull();
    expect(
      prepareAgenticSearchPrompt({ ...search, presentation: "explicit" }, search.template + "\n\n"),
    ).toBeNull();
  });
  it("keeps an explicitly edited prompt intact without duplicating instructions", () => {
    const edited = "Search for the deployment decision and keep it to one sentence.";
    expect(prepareAgenticSearchPrompt({ ...search, presentation: "explicit" }, edited)).toBe(
      edited,
    );
  });
});
