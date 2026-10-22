import { describe, expect, it } from "vite-plus/test";
import { ProjectId, type InboxSourceItem } from "@t3tools/contracts";
import { ingestInboxItem } from "./inboxState.ts";
import { findInboxPrecedents } from "./inboxMemory.ts";
const project = ProjectId.make("a");
const source: InboxSourceItem = {
  id: "1",
  source: "slack",
  connectionId: "a",
  groupId: "1",
  location: "#help",
  title: "Invoice export failed",
  author: "Sam",
  content: "How do I export an invoice?",
  url: "https://slack.com",
  occurredAt: "2026-10-22T10:00:00Z",
};
describe("project notification memory", () => {
  it("uses relevant confirmed outcomes, excluding other projects and unconfirmed proposals", () => {
    const current = ingestInboxItem(project, source);
    const known = {
      ...ingestInboxItem(project, { ...source, id: "2", groupId: "2" }),
      confirmedOutcome: "Confirmed: export from Billing > Invoices.",
    };
    const proposal = {
      ...ingestInboxItem(project, { ...source, id: "3", groupId: "3" }),
      state: { ...current.state, placement: "resolved" as const },
    };
    const foreign = { ...known, id: "foreign", projectId: ProjectId.make("b") };
    expect(findInboxPrecedents(current, [known, proposal, foreign]).map((item) => item.id)).toEqual(
      [known.id],
    );
    expect(findInboxPrecedents(current, [proposal, foreign])).toEqual([]);
  });
});
