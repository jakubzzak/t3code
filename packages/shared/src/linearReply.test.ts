import { expect, it } from "vite-plus/test";
import { createLinearConnection } from "./linearConnection.ts";

it.each([null, "original-comment"])(
  "creates a user comment with the preserved parent %s",
  async (parentId) => {
    const mutations: unknown[] = [];
    const client = createLinearConnection({
      clientId: "fixture-app",
      now: () => 0,
      redirectUri: "https://example.test/callback",
      read: async () =>
        JSON.stringify({
          project: {
            clientId: "fixture-app",
            accessToken: "fixture-token",
            refreshToken: "fixture-refresh",
            expiresAt: 999999999,
            connection: {
              workspace: "demo",
              userId: "me",
              name: "Me",
              email: "me@example.test",
              canReply: true,
            },
          },
        }),
      write: async () => {},
      authorize: async () => "unused",
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.query.startsWith("query"))
          return Response.json({ data: { viewer: { id: "me" }, organization: { id: "org" } } });
        mutations.push(body.variables);
        return Response.json({
          data: {
            commentCreate: {
              success: true,
              comment: {
                id: "posted",
                body: "Confirmed.",
                createdAt: "2026-10-29T08:00:00Z",
                user: { name: "Me" },
              },
            },
          },
        });
      },
    });
    const result = await client.createComment("project", "demo", "org:me", {
      issueId: "issue",
      parentId,
      body: "Confirmed.",
    });
    expect(result.id).toBe("posted");
    expect(mutations).toEqual([
      { input: { issueId: "issue", ...(parentId ? { parentId } : {}), body: "Confirmed." } },
    ]);
  },
);

it("keeps an old read-only connection readable and refuses posting before any mutation", async () => {
  const calls: unknown[] = [];
  const client = createLinearConnection({
    clientId: "fixture-app",
    now: () => 0,
    redirectUri: "https://example.test/callback",
    read: async () =>
      JSON.stringify({
        project: {
          accessToken: "fixture-token",
          refreshToken: "fixture-refresh",
          expiresAt: 999999999,
          connection: { workspace: "demo", userId: "me", name: "Me", email: "me@example.test" },
        },
      }),
    write: async () => {},
    authorize: async () => "unused",
    fetch: async (_url, init) => {
      calls.push(init?.body);
      return Response.json({ data: {} });
    },
  });
  expect(
    (await client.request({ operation: "status", workspace: "demo", connectionKey: "project" }))
      .connection?.userId,
  ).toBe("me");
  await expect(
    client.createComment("project", "demo", "org:me", {
      issueId: "issue",
      parentId: null,
      body: "Confirmed.",
    }),
  ).rejects.toMatchObject({ reason: "permission" });
  expect(calls).toEqual([]);
});

it("retains comment capability from older Linear applications returning an array of scopes", async () => {
  let saved: string | null = null;
  const client = createLinearConnection({
    clientId: "fixture-app",
    scopes: "read,comments:create",
    now: () => 0,
    redirectUri: "https://example.test/callback",
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
    authorize: async () => "fixture-code",
    fetch: async (url) =>
      String(url).endsWith("/oauth/token")
        ? Response.json({
            access_token: "fixture",
            refresh_token: "refresh",
            expires_in: 3600,
            scope: ["read", "comments:create"],
          })
        : Response.json({
            data: {
              viewer: { id: "me", name: "Me", email: "me@example.test" },
              organization: { urlKey: "demo" },
            },
          }),
  });
  const result = await client.request({
    operation: "connect",
    connectionKey: "project",
    workspace: "demo",
  });
  expect(result.connection?.canReply).toBe(true);
});
