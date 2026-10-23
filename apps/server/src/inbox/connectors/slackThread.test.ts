import { expect, it, vi } from "vite-plus/test";
import { readSlackThread } from "./slackThread.ts";

it("uses the parent count and exact latest timestamp beyond the first page, without loading all history", async () => {
  const read = vi.fn(async (_method: string, params: Record<string, string>) => {
    if (params.oldest)
      return {
        ok: true,
        messages: [{ ts: "1700000020.000001", user: "me", text: "Latest reply" }],
      };
    return {
      ok: true,
      messages: [
        {
          ts: "1700000000.000001",
          user: "Alex",
          text: "Root",
          reply_count: 20,
          latest_reply: "1700000020.000001",
        },
        { ts: "1700000001.000001", user: "Sam", text: "Earlier reply" },
      ],
      has_more: true,
      response_metadata: { next_cursor: "page2" },
    };
  });
  const result = await readSlackThread(read, "C1", "1700000000.000001");
  expect(result.replyCount).toBe(20);
  expect(result.messages.at(-1)?.content).toBe("Latest reply");
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(
    "conversations.replies",
    expect.objectContaining({ oldest: "1700000020.000001", inclusive: "true" }),
  );
  expect(result.nextCursor).toBe("page2");
});

it("resumes only the missing page and retains multiline replies, names and safe links", async () => {
  const first = await readSlackThread(
    async () => ({
      ok: true,
      messages: [
        {
          ts: "1700000000",
          user: "Alex",
          text: "Root",
          reply_count: 2,
          latest_reply: "1700000002",
        },
        { ts: "1700000002", user: "Sam", text: "Last" },
      ],
      response_metadata: { next_cursor: "next" },
    }),
    "C1",
    "1700000000",
  );
  const read = vi.fn(async () => ({
    ok: true,
    messages: [
      {
        ts: "1700000001",
        user: "Alex",
        text: "Line one\nLine two <https://example.com/report|report>",
      },
    ],
  }));
  const result = await readSlackThread(read, "C1", "1700000000", first);
  expect(read).toHaveBeenCalledOnce();
  expect(result.messages.map((message) => message.ts)).toEqual(["1700000001", "1700000002"]);
  expect(result.messages[0]?.content).toContain("Line one\nLine two");
  expect(result.messages[0]?.formattedContent).toContain("[report]");
  expect(result.nextCursor).toBeNull();
  expect(await readSlackThread(read, "C1", "1700000000", result)).toBe(result);
  expect(read).toHaveBeenCalledOnce();
});
