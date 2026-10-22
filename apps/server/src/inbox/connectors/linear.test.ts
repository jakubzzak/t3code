import { expect, it } from "vite-plus/test";
import { readLinearInbox } from "./linear.ts";
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
              comment: { body: "Please approve the date" },
              parentComment: { body: "Friday launch" },
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
  expect(items[0]).toMatchObject({ groupId: "issue", location: "ENG-1" });
  expect(items[0]?.content).toContain("Please approve the date");
  expect(items[0]?.content).toContain("Launch context");
  expect(items[1]?.title).toBe("Workspace announcement");
});

it("sends the cutoff on each page and excludes older notifications even if returned by the provider", async () => {
  const since = "2026-10-22T10:00:00.000Z";
  const requests: Array<{ after: string | null; since: string }> = [];
  const items = await readLinearInbox(
    async (query, variables) => {
      expect(query).toContain("filter: { createdAt: { gte: $since } }");
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
    { after: null, since },
    { after: "next", since },
  ]);
  expect(items.map((item) => item.id)).toEqual(["new"]);
});
