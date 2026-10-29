import { expect, it } from "vite-plus/test";
import { readLinearInbox, readLinearIssue } from "./linear.ts";
it("retains non-issue notifications and the targeted comment plus its issue context", async () => {
  const base = {
    id: "n",
    type: "issueComment",
    category: "commentsAndReplies",
    title: "Alex commented",
    subtitle: "Issue",
    url: "https://linear.app/x",
    groupingKey: "group",
    createdAt: "2026-10-22T10:00:00Z",
    actor: { name: "Alex" },
  };
  const items = await readLinearInbox(
    async () => ({
      data: {
        viewer: { id: "me" },
        organization: { id: "org" },
        notifications: {
          nodes: [
            {
              ...base,
              issue: {
                id: "issue",
                identifier: "ENG-1",
                title: "Launch",
                description: "Launch context",
              },
              comment: {
                id: "c2",
                body: "Please approve the date",
                createdAt: base.createdAt,
                user: { name: "Maya" },
              },
              parentComment: {
                id: "c1",
                body: "Friday launch",
                createdAt: "2026-10-21T10:00:00Z",
                user: null,
                botActor: { name: "Release bot" },
              },
            },
            {
              ...base,
              id: "system",
              type: "welcome",
              category: "system",
              title: "Workspace announcement",
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    }),
    ["all"],
    "2026-10-21T00:00:00.000Z",
  );
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    groupId: "issue",
    location: "ENG-1",
    replyTarget: { source: "linear", issueId: "issue", parentId: "c1" },
  });
  expect(items[0]?.content).toContain("Please approve the date");
  expect(items[0]?.content).toContain("Launch context");
  expect(items[0]?.linearIssue).toEqual({
    id: "issue",
    title: "Launch",
    description: "Launch context",
    commentsComplete: false,
    comments: [
      {
        id: "c1",
        body: "Friday launch",
        author: "Release bot",
        occurredAt: "2026-10-21T10:00:00Z",
      },
      { id: "c2", body: "Please approve the date", author: "Maya", occurredAt: base.createdAt },
    ],
  });
  expect(items[1]?.title).toBe("Workspace announcement");
});

it("sends the cutoff on each page and excludes older notifications even if returned by the provider", async () => {
  const since = "2026-10-22T10:00:00.000Z";
  const requests: Array<{ after: string | null; since: string }> = [];
  const items = await readLinearInbox(
    async (query, variables) => {
      expect(query).toContain("{ createdAt: { gte: $since } }");
      requests.push(variables);
      return {
        data: {
          viewer: { id: "me" },
          organization: { id: "org" },
          notifications: {
            nodes: [
              {
                id: variables.after ? "new" : "old",
                type: "welcome",
                category: "system",
                title: "Update",
                subtitle: "",
                url: "https://linear.app/x",
                groupingKey: "g",
                createdAt: variables.after ? since : "2026-10-22T09:59:59.999Z",
                actor: null,
              },
            ],
            pageInfo: { hasNextPage: !variables.after, endCursor: variables.after ? null : "next" },
          },
        },
      };
    },
    ["all"],
    since,
  );
  expect(requests).toEqual([
    { after: null, since, notificationIds: [] },
    { after: "next", since, notificationIds: [] },
  ]);
  expect(items.map((item) => item.id)).toEqual(["new"]);
});

it("loads all issue comments only on request, deduplicates pages, and uses comment authors/timestamps", async () => {
  const calls: Array<string | null> = [];
  const comment = (id: string, day: string) => ({
    id,
    body: `**${id}**`,
    createdAt: `2026-10-${day}T10:00:00Z`,
    user: { name: "Maya" },
  });
  const detail = await readLinearIssue(
    async (query, { after }) => {
      expect(query).toContain("comments(first: 50");
      calls.push(after);
      return {
        data: {
          issue: {
            id: "issue",
            title: "Review",
            description: "## Original Markdown",
            comments: {
              nodes: after
                ? [comment("new", "23"), comment("old", "21")]
                : [comment("middle", "22"), comment("old", "21")],
              pageInfo: { hasNextPage: !after, endCursor: after ? null : "next" },
            },
          },
        },
      };
    },
    "issue",
    true,
  );
  expect(calls).toEqual([null, "next"]);
  expect(detail?.comments.map((c) => c.id)).toEqual(["old", "middle", "new"]);
  expect(detail?.description).toBe("## Original Markdown");
  expect(detail?.commentsComplete).toBe(true);
  expect(detail?.comments[2]?.author).toBe("Maya");
});

it.each([null, "repeat"])(
  "rejects an incomplete or repeated comment cursor (%s)",
  async (cursor) => {
    await expect(
      readLinearIssue(
        async () => ({
          data: {
            issue: {
              id: "issue",
              title: "Review",
              description: null,
              comments: {
                nodes: [],
                pageInfo: { hasNextPage: true, endCursor: cursor },
              },
            },
          },
        }),
        "issue",
        true,
      ),
    ).rejects.toThrow(/cursor|paginated/);
  },
);

it("hydrates the latest comment preview without downloading history, and handles removed or wrong issues", async () => {
  const issue = { id: "issue", title: "Review", description: null };
  expect(
    await readLinearIssue(
      async (query) => {
        expect(query).toContain("latestComments: comments(last: 1");
        expect(query).toContain("nodes { id } pageInfo");
        expect(query).not.toContain("comments(first: 50, after:");
        return { data: { issue } };
      },
      "issue",
      false,
    ),
  ).toMatchObject({ comments: [], commentsComplete: false });
  expect(await readLinearIssue(async () => ({ data: { issue: null } }), "issue", true)).toBeNull();
  await expect(
    readLinearIssue(async () => ({ data: { issue: { ...issue, id: "other" } } }), "issue", false),
  ).rejects.toThrow("different issue");
});

it("imports the latest issue comment and exact count before Show all, counting IDs once per issue", async () => {
  let countCalls = 0;
  const comment = {
    id: "latest",
    body: "The newest reply",
    createdAt: "2026-10-23T10:00:00Z",
    user: { name: "Maya" },
  };
  const items = await readLinearInbox(
    async (query, variables) => {
      if (variables.id) {
        countCalls++;
        expect(query).not.toContain("body");
        expect(variables).toMatchObject({ id: "issue", after: "count-next" });
        return {
          data: {
            issue: {
              id: "issue",
              commentIndex: {
                nodes: [{ id: "middle" }, { id: "latest" }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }
      expect(query).toContain("latestComments: comments(last: 1");
      const issue = {
        id: "issue",
        identifier: "ENG-1",
        title: "Launch",
        description: "Context",
        latestComments: { nodes: [comment] },
        commentIndex: {
          nodes: [{ id: "old" }, { id: "middle" }],
          pageInfo: { hasNextPage: true, endCursor: "count-next" },
        },
      };
      return {
        data: {
          viewer: { id: "me" },
          organization: { id: "org" },
          notifications: {
            nodes: ["first", "second"].map((id) => ({
              id,
              type: "issueAssignedToYou",
              category: "assignments",
              title: "Assigned",
              subtitle: "Issue",
              url: "https://linear.app/x",
              groupingKey: "issue",
              createdAt: "2026-10-22T10:00:00Z",
              actor: null,
              issue,
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
    },
    ["all"],
    "2026-10-21T00:00:00Z",
  );
  expect(countCalls).toBe(1);
  expect(items).toHaveLength(2);
  for (const item of items) {
    expect(item.linearIssue).toMatchObject({
      commentCount: 3,
      commentsComplete: false,
      comments: [{ id: "latest", author: "Maya", body: "The newest reply" }],
    });
    expect(item.content).toContain("The newest reply");
  }
});

it("recognizes an issue with no comments on the initial detail request", async () => {
  const result = await readLinearIssue(
    async () => ({
      data: {
        issue: {
          id: "issue",
          title: "Launch",
          description: null,
          latestComments: { nodes: [] },
          commentIndex: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      },
    }),
    "issue",
    false,
  );
  expect(result).toMatchObject({ comments: [], commentCount: 0, commentsComplete: true });
});

it("observes self comments without a source notification and ignores other connections", async () => {
  const calls: string[] = [];
  const items = await readLinearInbox(
    async (query, variables) => {
      calls.push(query);
      if (query.includes("BlackbirdInboxReplies")) {
        expect(variables).toMatchObject({ issueIds: ["issue"], since: "2026-10-22T00:00:00Z" });
        return {
          data: {
            comments: {
              nodes: [
                {
                  id: "own",
                  body: "Done",
                  createdAt: "2026-10-22T12:00:00Z",
                  user: { id: "me", name: "Me" },
                  issue: {
                    id: "issue",
                    identifier: "ENG-1",
                    title: "Review",
                    description: "Context",
                    url: "https://linear.app/issue/ENG-1",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      return {
        data: {
          viewer: { id: "me" },
          organization: { id: "org" },
          notifications: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
    },
    ["all"],
    "2026-10-22T00:00:00Z",
    [
      { connectionId: "org:me", groupId: "issue" },
      { connectionId: "other:me", groupId: "private" },
    ],
  );
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    groupId: "issue",
    content: "Done\n\nContext",
    replyActivity: [{ id: "own", occurredAt: "2026-10-22T12:00:00Z", isSelf: true }],
  });
  expect(calls).toHaveLength(2);
});

it.each([null, "repeat"])(
  "rejects incomplete tracked-comment pagination (%s) without returning partial intake",
  async (cursor) => {
    await expect(
      readLinearInbox(
        async (query) => {
          if (query.includes("BlackbirdInboxReplies"))
            return {
              data: {
                comments: {
                  nodes: [],
                  pageInfo: { hasNextPage: true, endCursor: cursor },
                },
              },
            };
          return {
            data: {
              viewer: { id: "me" },
              organization: { id: "org" },
              notifications: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          };
        },
        ["all"],
        "2026-10-22T00:00:00Z",
        [{ connectionId: "org:me", groupId: "issue" }],
      ),
    ).rejects.toThrow("reply history");
  },
);

it.each(["projectUpdate", "project"])(
  "discovers self replies for tracked %s comments without a notification",
  async (kind) => {
    const items = await readLinearInbox(
      async (query) => {
        if (query.includes("BlackbirdInboxReplies"))
          return {
            data: {
              comments: {
                nodes: [
                  {
                    id: "own-project-comment",
                    body: "Project review completed",
                    createdAt: "2026-10-22T12:00:00Z",
                    user: { id: "me", name: "Me" },
                    issue: null,
                    [kind]: { id: "native-project" },
                    parent: { id: "native-target" },
                    url: "https://linear.app/project/update#comment",
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          };
        return {
          data: {
            viewer: { id: "me" },
            organization: { id: "org" },
            notifications: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          },
        };
      },
      ["all"],
      "2026-10-22T00:00:00Z",
      [
        {
          connectionId: "org:me",
          groupId: "opaque-native-group",
          linearCommentTarget: "comment:native-target",
        },
      ],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      groupId: "opaque-native-group",
      linearCommentTarget: "comment:native-target",
      content: "Project review completed",
      replyActivity: [{ id: "own-project-comment", isSelf: true }],
    });
  },
);
