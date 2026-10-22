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
  );
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({ groupId: "issue", location: "ENG-1" });
  expect(items[0]?.content).toContain("Please approve the date");
  expect(items[0]?.content).toContain("Launch context");
  expect(items[1]?.title).toBe("Workspace announcement");
});
