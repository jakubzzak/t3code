import { expect, it } from "vite-plus/test";
import { readSuperhumanInbox } from "./superhuman.ts";
it("uses actual split membership, explicit accounts, and full thread context without source writes", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const items = await readSuperhumanInbox(
    async (name, args) => {
      calls.push({ name, args });
      if (name === "list_accounts")
        return {
          accounts: [
            { accountEmail: "work@example.com", isPrimary: true },
            { accountEmail: "personal@example.com", isPrimary: false },
          ],
        };
      if (name === "list_threads")
        return {
          threads: [
            {
              thread_id: "thread-1",
              subject: "Friday review",
              snippet: "Friday?",
              last_message_at: "2026-10-22T10:00:00Z",
              last_message_id: "m2",
              labels: ["Product"],
              splits: ["Important"],
            },
          ],
        };
      if (name === "get_thread")
        return {
          thread_id: "thread-1",
          subject: "Friday review",
          snippet: "Friday?",
          last_message_at: "2026-10-22T10:00:00Z",
          last_message_id: "m2",
          labels: ["Product"],
          splits: ["Important"],
          messages: [
            {
              message_id: "m1",
              from: "Alex",
              sent_at: "2026-10-21T10:00:00Z",
              body: "Launch metrics are ready",
              snippet: "",
              is_draft: false,
            },
            {
              message_id: "m2",
              from: "Sam",
              sent_at: "2026-10-22T10:00:00Z",
              body: '<html><body><div>Does Friday work?</div><div style="display:none">tracking-only</div><img src="https://tracking.example/pixel"></body></html>',
              snippet: "",
              is_draft: false,
            },
          ],
          comments: [
            {
              comment_id: "c1",
              author_name: "Maya",
              created_at: "2026-10-22T10:01:00Z",
              body: "Review is prepared",
            },
          ],
        };
      throw new Error(`Unexpected operation: ${name}`);
    },
    ["work@example.com"],
    ["split:Important", "label:Product"],
    "2026-10-21T00:00:00.000Z",
  );
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    source: "superhuman",
    connectionId: "work@example.com",
    groupId: "thread-1",
  });
  expect(items[0]?.content).toContain("Launch metrics are ready");
  expect(items[0]?.content).toContain("Does Friday work?");
  expect(items[0]?.contentFormat).toBe("text");
  expect(items[0]?.content).not.toMatch(/<html|<div|tracking-only|tracking.example/);
  expect(items[0]?.content).toContain("Maya");
  expect(calls.filter((call) => call.name === "list_threads").map((call) => call.args)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ acting_email: "work@example.com", split: "Important" }),
      expect.objectContaining({ acting_email: "work@example.com", labels: ["Product"] }),
    ]),
  );
  expect(calls.some((call) => call.args.acting_email === "personal@example.com")).toBe(false);
  expect(calls.filter((call) => call.name === "get_thread")).toHaveLength(1);
});

it("sends the history boundary on every page and never downloads an older thread", async () => {
  const since = "2026-10-22T10:00:00.000Z";
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const thread = (id: string, at: string) => ({
    thread_id: id,
    subject: id,
    snippet: id,
    last_message_at: at,
    last_message_id: id,
    labels: [],
  });
  const items = await readSuperhumanInbox(
    async (name, args) => {
      calls.push({ name, args });
      if (name === "list_accounts")
        return { accounts: [{ accountEmail: "work@example.com", isPrimary: true }] };
      if (name === "list_threads")
        return args.cursor
          ? { threads: [thread("boundary", since)] }
          : { threads: [thread("old", "2026-10-22T09:59:59.999Z")], next_cursor: "page-two" };
      if (name === "get_thread") return thread("boundary", since);
      throw new Error("Unexpected read");
    },
    ["work@example.com"],
    ["split:Important"],
    since,
  );
  expect(items.map((item) => item.id)).toEqual(["boundary"]);
  expect(
    calls.filter((call) => call.name === "get_thread").map((call) => call.args.thread_id),
  ).toEqual(["boundary"]);
  expect(
    calls.filter((call) => call.name === "list_threads").map((call) => call.args.start_date),
  ).toEqual([since, since]);
});
