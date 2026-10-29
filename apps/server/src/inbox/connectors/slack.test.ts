import { describe, expect, it } from "vite-plus/test";
import { SlackReadError, readSlackInbox as readSlackBatch } from "./slack.ts";
it("loads a parent thread identified by reply_count even without thread_ts", async () => {
  const root = {
    ts: "1792620000.000000",
    user: "Alex",
    text: "Review the release",
    reply_count: 1,
    latest_reply: "1792620001.000000",
  };
  const items = await readSlackInbox(
    async (method) => {
      if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T1" };
      if (method === "conversations.list")
        return { ok: true, channels: [{ id: "D1", user: "Alex", is_im: true }] };
      if (method === "conversations.history") return { ok: true, messages: [root] };
      if (method === "conversations.replies")
        return {
          ok: true,
          messages: [root, { ts: root.latest_reply, user: "Maya", text: "Screenshots are ready" }],
        };
      if (method === "search.messages")
        return { ok: true, messages: { matches: [], paging: { pages: 1 } } };
      throw new Error(method);
    },
    ["dms"],
    "2026-10-01T00:00:00Z",
  );
  expect(items[0]?.slackThread?.latestReplyTs).toBe(root.latest_reply);
  expect(items[0]?.slackThread?.messages[0]?.content).toBe("Screenshots are ready");
});
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
            messages: [
              { ts: "1792620000.000000", text: "Launch context", user: "Alex" },
              {
                ts: args.oldest || "1792620002.000000",
                text: "Could you review?",
                user: "Alex",
                thread_ts: "1792620000.000000",
              },
            ],
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
    expect(calls.filter((call) => call === "search.messages")).toHaveLength(3);
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
                permalink:
                  "https://slack.com/archives/C1/p1792620002000000?thread_ts=1792620000.000000",
              },
            ],
            paging: { pages: 1 },
          },
        };
      if (method === "conversations.history")
        return {
          ok: true,
          messages: [],
        };
      if (method === "conversations.replies")
        return {
          ok: true,
          messages: [
            { ts: "1792620000.000000", text: "Release context", user: "Alex" },
            {
              ts: "1792620002.000000",
              thread_ts: "1792620000.000000",
              text: "Review please",
              user: "Alex",
            },
          ],
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
            {
              ts: "1792620000",
              reply_count: 20,
              latest_reply: "1792620002",
              user: "Sam",
              text: "Start",
            },
          ],
        };
      if (method === "conversations.replies")
        return {
          ok: true,
          messages: [
            {
              ts: "1792620000",
              user: "Sam",
              text: "Start",
              reply_count: 20,
              latest_reply: "1792620002",
            },
            { ts: "1792620002", user: "Alex", text: "Please review" },
          ],
          has_more: true,
          response_metadata: { next_cursor: "more" },
        };
      if (method === "search.messages")
        return { ok: true, messages: { matches: [], paging: { pages: 1 } } };
      throw new Error(method);
    },
    ["dms"],
    "2026-10-01T00:00:00Z",
  );
  expect(items[0]?.content).toContain("Additional thread messages omitted");
});

it("preserves Slack links, resolves people and groups, and retains the complete native message", async () => {
  const calls: string[] = [];
  const items = await readSlackInbox(
    async (method) => {
      calls.push(method);
      if (method === "auth.test") return { ok: true, user_id: "U000ME", team_id: "T1" };
      if (method === "users.info")
        return { ok: true, user: { id: "U123", profile: { display_name: "Alex" } } };
      if (method === "usergroups.list")
        return { ok: true, usergroups: [{ id: "S123", handle: "support", users: ["U000ME"] }] };
      if (method === "search.messages")
        return {
          ok: true,
          messages: {
            matches: [
              {
                ts: "1792620002",
                user: "U123",
                text: "Truncated search snippet",
                channel: { id: "C1", name: "support" },
                permalink: "https://slack.com/archives/C1/message",
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
              ts: "1792620002",
              user: "U123",
              text: "<@U123> and <!subteam^S123> please review <https://example.com/report?a=1&amp;b=2|the report> &amp; reply. *Urgent*",
            },
          ],
        };
      throw new Error(method);
    },
    ["mentions"],
    "2026-10-01T00:00:00Z",
  );
  expect(items[0]?.author).toBe("Alex");
  expect(items[0]?.content).toContain("@Alex");
  expect(items[0]?.content).toContain("@support");
  expect(items[0]?.formattedContent).toContain(
    "[the report](<https://example.com/report?a=1&b=2>)",
  );
  expect(items[0]?.formattedContent).toContain("**Urgent**");
  expect(items[0]?.slackMentions?.map(({ id, personal }) => ({ id, personal }))).toEqual([
    { id: "U123", personal: false },
    { id: "S123", personal: true },
  ]);
  expect(calls.filter((method) => method === "auth.test")).toHaveLength(1);
  expect(calls.filter((method) => method === "usergroups.list")).toHaveLength(1);
  expect(items[0]?.contentFormat).toBe("text");
  expect(calls.filter((method) => method === "users.info")).toHaveLength(1);
});

it("keeps block-only message content and attachment links without downloading media", async () => {
  const items = await readSlackInbox(
    async (method) => {
      if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T1" };
      if (method === "conversations.list")
        return { ok: true, channels: [{ id: "D1", user: "Alex" }] };
      if (method === "conversations.history")
        return {
          ok: true,
          messages: [
            {
              ts: "1792620002",
              text: null,
              bot_profile: { name: "Signal" },
              blocks: [
                {
                  type: "rich_text",
                  elements: [
                    {
                      type: "rich_text_section",
                      elements: [
                        { type: "text", text: "Review " },
                        { type: "link", url: "https://example.com/report", text: "the report" },
                      ],
                    },
                  ],
                },
              ],
              attachments: [
                {
                  title: "Supporting context",
                  title_link: "https://example.com/context",
                  text: "The deadline is today.",
                  image_url: "https://tracker.example/pixel",
                },
              ],
            },
          ],
        };
      if (method === "search.messages")
        return { ok: true, messages: { matches: [], paging: { pages: 1 } } };
      throw new Error(method);
    },
    ["dms"],
    "2026-10-01T00:00:00Z",
  );
  expect(items[0]?.author).toBe("Signal");
  expect(items[0]?.formattedContent).toContain("Review [the report](<https://example.com/report>)");
  expect(items[0]?.formattedContent).toContain(
    "[Supporting context](<https://example.com/context>)",
  );
  expect(items[0]?.content).toContain("The deadline is today.");
  expect(items[0]?.content).not.toContain("tracker.example");
});
it("retains links and unresolved mentions when an older connection lacks profile permission", async () => {
  let profiles = 0;
  const items = await readSlackInbox(
    async (method) => {
      if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T1" };
      if (method === "conversations.list") return { ok: true, channels: [{ id: "D1" }] };
      if (method === "conversations.history")
        return {
          ok: true,
          messages: [
            { ts: "1792620002", user: "U123", text: "<@U456> review <https://example.com|report>" },
          ],
        };
      if (method === "users.info") {
        profiles++;
        throw new Error("Slack users.info failed (missing_scope).");
      }
      if (method === "search.messages")
        return { ok: true, messages: { matches: [], paging: { pages: 1 } } };
      throw new Error(method);
    },
    ["dms"],
    "2026-10-01T00:00:00Z",
  );
  expect(items[0]?.content).toContain("@U456");
  expect(items[0]?.formattedContent).toContain("[report](<https://example.com/>)");
  expect(profiles).toBe(1);
});

it("stops mention pagination at the checkpoint without hydrating older matches", async () => {
  const calls: Array<[string, Record<string, string>]> = [];
  const items = await readSlackInbox(
    async (method, args) => {
      calls.push([method, args]);
      if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T1" };
      if (method === "search.messages")
        return {
          ok: true,
          messages: {
            matches: [
              {
                ts: "1792674060.000000",
                user: "Alex",
                text: "New",
                thread_ts: "1792600000.000000",
                channel: { id: "C1", name: "launch" },
                permalink: "https://slack.com/new",
              },
              {
                ts: "1792673940.000000",
                user: "Alex",
                text: "Old",
                channel: { id: "C1", name: "launch" },
                permalink: "https://slack.com/old",
              },
            ],
            paging: { pages: 80 },
          },
        };
      if (method === "conversations.replies")
        return {
          ok: true,
          messages: [
            {
              ts: args.oldest ?? args.ts,
              user: "Alex",
              text: args.oldest ? "New" : "Root",
              ...(args.oldest ? { thread_ts: args.ts } : {}),
            },
          ],
        };
      throw new Error(`Unnecessary old-message request: ${method}`);
    },
    ["mentions"],
    "2026-10-22T13:00:00.000Z",
  );
  expect(items.map((item) => item.content.split("\n")[0])).toEqual(["New"]);
  expect(calls.filter(([method]) => method === "search.messages")).toEqual([
    [
      "search.messages",
      expect.objectContaining({ sort: "timestamp", sort_dir: "desc", page: "1" }),
    ],
  ]);
  expect(calls.filter(([method]) => method === "conversations.history")).toEqual([]);
});

it("discovers new non-mentioned DM replies independently of an older parent history window", async () => {
  const calls: Array<[string, Record<string, string>]> = [];
  const root = {
    ts: "1792620000.000000",
    user: "Alex",
    text: "Old request",
    reply_count: 1,
    latest_reply: "1792706400.000000",
  };
  const reply = {
    ts: root.latest_reply,
    user: "Maya",
    text: "New information",
    thread_ts: root.ts,
  };
  const items = await readSlackInbox(
    async (method, args) => {
      calls.push([method, args]);
      if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T" };
      if (method === "conversations.list")
        return { ok: true, channels: [{ id: "D1", user: "Alex", is_im: true }] };
      if (method === "conversations.history") return { ok: true, messages: [] };
      if (method === "search.messages")
        return {
          ok: true,
          messages: {
            matches: [
              {
                ts: reply.ts,
                user: reply.user,
                text: "abbreviated",
                channel: { id: "D1", name: "Alex" },
                permalink: `https://example.slack.com/archives/D1/p1792706400000000?thread_ts=${root.ts}&cid=D1`,
              },
            ],
            paging: { pages: 1 },
          },
        };
      if (method === "conversations.replies")
        return { ok: true, messages: args.oldest ? [reply] : [root, reply] };
      throw new Error(method);
    },
    ["dms"],
    "2026-10-22T00:00:00Z",
  );
  expect(items).toHaveLength(1);
  expect(items[0]?.groupId).toBe(`D1:${root.ts}`);
  expect(items[0]?.content).toContain("New information");
  expect(items[0]?.slackThread?.root.content).toBe("Old request");
  expect(calls.find(([method]) => method === "search.messages")?.[1].query).toContain(
    "is:dm is:thread",
  );
});

it("observes self and unmentioned incoming replies on a tracked channel thread", async () => {
  const root = {
    ts: "1792620000.000000",
    user: "UOTHER",
    text: "Review",
    reply_count: 1,
    latest_reply: "1792623600.000000",
  };
  const own = { ts: "1792623600.000000", thread_ts: root.ts, user: "UME", text: "Done" };
  const calls: Array<[string, Record<string, string>]> = [];
  const items = await readSlackInbox(
    async (method, params) => {
      calls.push([method, params]);
      if (method === "auth.test") return { ok: true, user_id: "UME", team_id: "T1" };
      if (method === "users.info") return { user: { name: params.user } };
      if (method === "search.messages")
        return {
          ok: true,
          messages: {
            matches: params.query?.startsWith("is:thread")
              ? [
                  {
                    ...own,
                    permalink: `https://slack.com/archives/C1/p1792623600000000?thread_ts=${root.ts}`,
                    channel: { id: "C1", name: "launch" },
                  },
                ]
              : [],
            paging: { pages: 1 },
          },
        };
      if (method === "conversations.replies")
        return { ok: true, messages: params.oldest ? [own] : [root, own] };
      throw new Error(`Unexpected ${method}`);
    },
    ["mentions"],
    "2026-10-21T20:00:00Z",
    [{ connectionId: "T1:UME", groupId: `C1:${root.ts}` }],
  );
  expect(items).toHaveLength(1);
  expect(items[0]?.replyActivity).toEqual([
    { id: `C1:${own.ts}`, occurredAt: items[0]?.occurredAt, isSelf: true },
  ]);
  expect(items[0]?.slackThread?.messages.at(-1)?.content).toBe("Done");
  expect(
    calls.some(
      ([method, params]) =>
        method === "conversations.replies" &&
        params.oldest === String(Date.parse("2026-10-21T20:00:00Z") / 1000),
    ),
  ).toBe(true);
});

it("does not poll retained Slack threads when incremental search is quiet", async () => {
  const calls: string[] = [];
  const items = await readSlackInbox(
    async (method) => {
      calls.push(method);
      if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T" };
      if (method === "search.messages")
        return { ok: true, messages: { matches: [], paging: { pages: 1 } } };
      if (method === "conversations.replies") return { ok: true, messages: [] };
      throw new Error(method);
    },
    ["mentions"],
    "2026-10-22T00:00:00Z",
    Array.from({ length: 1000 }, (_, i) => ({
      connectionId: "T:me",
      groupId: `C${i}:1792620000.000000`,
    })),
  );
  expect(items).toEqual([]);
  expect(calls.length).toBeLessThanOrEqual(3);
  expect(calls).not.toContain("conversations.replies");
});

it.each(["thread_not_found", "channel_not_found", "not_in_channel"])(
  "isolates inaccessible tracked threads (%s) from healthy intake",
  async (code) => {
    const root = "1792620000.000000";
    const ts = "1792706400.000000";
    const batch = await readSlackBatch(
      async (method, args) => {
        if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T" };
        if (method === "users.info") return { user: { name: args.user } };
        if (method === "search.messages")
          return {
            ok: true,
            messages: {
              matches: [
                {
                  ts,
                  thread_ts: root,
                  user: "other",
                  text: "Hello",
                  channel: {
                    id: args.query?.startsWith("is:thread") ? "DELETED" : "HEALTHY",
                    name: "test",
                  },
                  permalink: "https://slack.com/archives/test/p1792706400000000",
                },
              ],
              paging: { pages: 1 },
            },
          };
        if (method === "conversations.replies") {
          if (args.channel === "DELETED") throw new SlackReadError(method, code);
          return {
            ok: true,
            messages: [
              ...(args.oldest
                ? []
                : [
                    { ts: root, user: "other", text: "Original", reply_count: 1, latest_reply: ts },
                  ]),
              { ts, thread_ts: root, user: "other", text: "Hello" },
            ],
          };
        }
        throw new Error(method);
      },
      ["mentions"],
      "2026-10-22T00:00:00Z",
      [{ connectionId: "T:me", groupId: `DELETED:${root}` }],
    );
    expect(batch.items.some((item) => item.groupId === `HEALTHY:${root}`)).toBe(true);
    expect(batch.slackRetryThreads).toEqual(
      code === "thread_not_found"
        ? []
        : [{ connectionId: "T:me", groupId: `DELETED:${root}`, since: "2026-10-22T00:00:00Z" }],
    );
  },
);

it("fetches adjacent unmentioned replies across pages when search returns only the self reply", async () => {
  const root = {
    ts: "1792620000.000000",
    user: "other",
    text: "Review",
    reply_count: 2,
    latest_reply: "1792706460.000000",
  };
  const incoming = {
    ts: "1792706400.000000",
    thread_ts: root.ts,
    user: "other",
    text: "New request",
  };
  const own = { ts: root.latest_reply, thread_ts: root.ts, user: "me", text: "Confirmed" };
  const cursors: string[] = [];
  const items = await readSlackInbox(
    async (method, args) => {
      if (method === "auth.test") return { ok: true, user_id: "me", team_id: "T" };
      if (method === "users.info") return { user: { name: args.user } };
      if (method === "search.messages")
        return {
          ok: true,
          messages: {
            matches: args.query?.startsWith("is:thread")
              ? [
                  {
                    ...own,
                    channel: { id: "C", name: "review" },
                    permalink: `https://slack.com/archives/C/p1?thread_ts=${root.ts}`,
                  },
                ]
              : [],
            paging: { pages: 1 },
          },
        };
      if (method === "conversations.replies") {
        if (!args.oldest) return { ok: true, messages: [root, incoming, own] };
        cursors.push(args.cursor ?? "");
        return args.cursor
          ? { ok: true, messages: [own] }
          : {
              ok: true,
              messages: [incoming],
              has_more: true,
              response_metadata: { next_cursor: "next" },
            };
      }
      throw new Error(method);
    },
    ["mentions"],
    "2026-10-22T00:00:00Z",
    [{ connectionId: "T:me", groupId: `C:${root.ts}` }],
  );
  expect(items.map((item) => item.id)).toEqual([`C:${incoming.ts}`, `C:${own.ts}`]);
  expect(cursors).toEqual(["", "next"]);
});

const readSlackInbox = (...args: Parameters<typeof readSlackBatch>) =>
  readSlackBatch(...args).then((batch) => batch.items);

it("bounds retries, rotates denied threads and excludes another account's pending work", async () => {
  const since = "2026-10-22T00:00:00Z";
  const pending = Array.from({ length: 51 }, (_, index) => ({
    connectionId: "T:me",
    groupId: `C${index}:1792620000.000000`,
    since,
  }));
  const attempted: string[] = [];
  let denied = true;
  const read: Parameters<typeof readSlackBatch>[0] = async (method, args) => {
    if (method === "auth.test") return { ok: true, team_id: "T", user_id: "me" };
    if (method === "search.messages")
      return { ok: true, messages: { matches: [], paging: { pages: 1 } } };
    if (method === "conversations.replies") {
      attempted.push(args.channel!);
      expect(args.oldest).toBe(String(Date.parse(since) / 1000));
      if (denied) throw new SlackReadError(method, "not_in_channel");
      return { ok: true, messages: [] };
    }
    throw new Error(method);
  };
  const first = await readSlackBatch(
    read,
    ["mentions"],
    "2026-10-23T00:00:00Z",
    [],
    [...pending, { connectionId: "other:me", groupId: "PRIVATE:1", since }],
  );
  expect(attempted).toHaveLength(50);
  expect(first.slackRetryThreads).toHaveLength(51);
  expect(first.slackRetryThreads[0]?.groupId).toBe(pending[50]?.groupId);
  denied = false;
  attempted.length = 0;
  const second = await readSlackBatch(
    read,
    ["mentions"],
    "2026-10-24T00:00:00Z",
    [],
    first.slackRetryThreads,
  );
  expect(attempted).toHaveLength(50);
  expect(attempted[0]).toBe("C50");
  expect(second.slackRetryThreads).toEqual([pending[49]]);
});
