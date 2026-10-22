import { describe, expect, it } from "vite-plus/test";
import { readSlackInbox } from "./slack.ts";
describe("supported Slack intake", () => {
  it.each([null, undefined, ""])(
    "keeps bot search matches without a user ID (%s)",
    async (user) => {
      const items = await readSlackInbox(
        async (method) => {
          if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T1" };
          if (method === "search.messages")
            return {
              ok: true,
              messages: {
                matches: [
                  {
                    ts: "1792620002.000000",
                    text: "Please check the alert",
                    ...(user === undefined ? {} : { user }),
                    username: "Monitor",
                    channel: { id: "C1", name: "alerts" },
                    permalink: "https://slack.com/archives/C1/message",
                  },
                  {
                    ts: "1792620003.000000",
                    text: "My own message",
                    user: "me",
                    channel: { id: "C1", name: "alerts" },
                    permalink: "https://slack.com/archives/C1/own",
                  },
                ],
                paging: { pages: 1 },
              },
            };
          if (method === "conversations.history")
            return {
              ok: true,
              messages: [
                {
                  ts: "1792620002.000000",
                  ...(user === undefined ? {} : { user }),
                  username: "Monitor",
                  text: "Please check the alert",
                },
              ],
            };
          throw new Error(`Unexpected method ${method}`);
        },
        ["mentions"],
        "2026-10-01T00:00:00Z",
      );
      expect(items).toHaveLength(1);
      expect(items[0]?.author).toBe("Monitor");
      expect(items[0]?.content).toBe("Please check the alert");
      expect(items[0]?.groupId).toBe("C1:1792620002.000000");
    },
  );

  it("reads DMs and personal/group mentions with thread context, excluding authored messages and undocumented endpoints", async () => {
    const calls: string[] = [];
    const items = await readSlackInbox(
      async (method, args) => {
        calls.push(method);
        if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T1" };
        if (method === "conversations.list")
          return { ok: true, channels: [{ id: "D1", user: "Alex", is_im: true }] };
        if (method === "conversations.history")
          return {
            ok: true,
            messages: [
              { ts: "1792620000.000000", text: "Please check this", user: "Alex" },
              { ts: "1792620001.000000", text: "My own message", user: "me" },
            ],
          };
        if (method === "usergroups.list")
          return {
            ok: true,
            usergroups: [
              { id: "S1", users: ["me"] },
              { id: "S2", users: ["other"] },
            ],
          };
        if (method === "conversations.replies")
          return {
            ok: true,
            messages: [{ ts: "1792620000.000000", text: "Launch context", user: "Alex" }],
          };
        if (method === "search.messages")
          return {
            ok: true,
            messages: {
              matches: [
                {
                  ts: args.query?.startsWith("<@") ? "1792620002.000000" : "1792620003.000000",
                  text: "Could you review?",
                  user: "Alex",
                  thread_ts: "1792620000.000000",
                  channel: { id: "C1", name: "launch" },
                  permalink: "https://slack.com/archives/C1/message",
                },
              ],
              paging: { pages: 1 },
            },
          };
        throw new Error(`Unexpected method ${method}`);
      },
      ["dms", "mentions", "group-mentions", "saved", "todos"],
      "2026-10-01T00:00:00Z",
    );
    expect(items).toHaveLength(3);
    expect(items.filter((item) => item.groupId === "C1:1792620000.000000")).toHaveLength(2);
    expect(items[1]?.content).toContain("Launch context");
    expect(calls).not.toContain("stars.list");
    expect(calls.filter((call) => call === "search.messages")).toHaveLength(2);
  });
});

it("resolves a search hit to its native thread when search omits thread_ts", async () => {
  const items = await readSlackInbox(
    async (method) => {
      if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T1" };
      if (method === "search.messages")
        return {
          ok: true,
          messages: {
            matches: [
              {
                ts: "1792620002.000000",
                text: "Review please",
                user: "Alex",
                channel: { id: "C1", name: "launch" },
                permalink: "https://slack.com/archives/C1/p1792620002000000",
              },
            ],
            paging: { pages: 1 },
          },
        };
      if (method === "conversations.history")
        return {
          ok: true,
          messages: [
            {
              ts: "1792620002.000000",
              thread_ts: "1792620000.000000",
              text: "Review please",
              user: "Alex",
            },
          ],
        };
      if (method === "conversations.replies")
        return {
          ok: true,
          messages: [{ ts: "1792620000.000000", text: "Release context", user: "Alex" }],
        };
      throw new Error(method);
    },
    ["mentions"],
    "2026-10-01T00:00:00Z",
  );
  expect(items[0]?.groupId).toBe("C1:1792620000.000000");
  expect(items[0]?.content).toContain("Release context");
});

it("reports incomplete thread context instead of presenting a truncated thread as complete", async () => {
  const items = await readSlackInbox(
    async (method) => {
      if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T" };
      if (method === "conversations.list") return { ok: true, channels: [{ id: "D" }] };
      if (method === "conversations.history")
        return {
          ok: true,
          messages: [
            { ts: "1792620002", thread_ts: "1792620000", user: "Alex", text: "Please review" },
          ],
        };
      if (method === "conversations.replies")
        return {
          ok: true,
          messages: [{ ts: "1792620000", user: "Sam", text: "Start" }],
          has_more: true,
          response_metadata: { next_cursor: "more" },
        };
      throw new Error(method);
    },
    ["dms"],
    "2026-10-01T00:00:00Z",
  );
  expect(items[0]?.content).toContain("Additional thread messages omitted");
});
