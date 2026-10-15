import type { LinearDesktopRequest } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createLinearConnection, type LinearConnectionDependencies } from "./linearConnection.ts";

function fixture() {
  let saved: string | null = null;
  const calls: { url: string; body: string }[] = [];
  const authorizations: URL[] = [];
  let cancel = false;
  let now = 0;
  let issueResponse: unknown = null;
  let refreshes = 0;
  const dependencies: LinearConnectionDependencies = {
    clientId: "test-client",
    now: () => now,
    redirectUri: "http://127.0.0.1:47289/linear/callback",
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
    authorize: async (url) => {
      authorizations.push(new URL(url));
      if (cancel) throw new Error("Canceled");
      return "test-code";
    },
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? "") });
      if (url.endsWith("/oauth/token")) {
        const refresh =
          new URLSearchParams(String(init?.body)).get("grant_type") === "refresh_token";
        if (refresh) refreshes++;
        return Response.json({
          access_token: "private-access",
          refresh_token: refresh ? "rotated-refresh" : "private-refresh",
          expires_in: 86400,
        });
      }
      if (issueResponse && String(init?.body).includes("query Teams"))
        return Response.json(issueResponse);
      if (issueResponse && String(init?.body).includes("query Issues"))
        return Response.json(issueResponse);
      if (issueResponse && String(init?.body).includes("query Assigned"))
        return Response.json(issueResponse);
      if (issueResponse && String(init?.body).includes("query CreatedIssue"))
        return Response.json(issueResponse);
      if (issueResponse && String(init?.body).includes("query Search"))
        return Response.json(issueResponse);
      return Response.json({
        data: {
          viewer: { id: "user-1", name: "Test User", email: "test@example.com" },
          organization: { urlKey: "acme" },
        },
      });
    },
  };
  const client = createLinearConnection(dependencies);
  return {
    client,
    withoutClientId: () => createLinearConnection({ ...dependencies, clientId: "" }),
    calls,
    authorizations,
    cancel: () => {
      cancel = true;
    },
    saved: () => saved,
    advance: () => {
      now += 86_400_000;
    },
    setIssues: (data: unknown) => {
      issueResponse = data;
    },
    refreshes: () => refreshes,
  };
}

describe("Linear connection", () => {
  it("uses user OAuth with S256 and read scope, stores tokens without returning them", async () => {
    const f = fixture();
    const result = await f.client.request({
      operation: "connect",
      workspace: "acme",
      connectionKey: "env/project",
    });
    expect(result.connection).toMatchObject({ workspace: "acme", userId: "user-1" });
    const url = f.authorizations[0]!;
    expect(url.searchParams.get("scope")).toBe("read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();
    const exchange = new URLSearchParams(f.calls[0]!.body);
    expect(exchange.get("client_secret")).toBeNull();
    expect(exchange.get("code_verifier")).toBeTruthy();
    expect(f.saved()).toContain("private-refresh");
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it("keeps a working connection when a new authorization is canceled", async () => {
    const f = fixture();
    await f.client.request({
      operation: "connect",
      workspace: "acme",
      connectionKey: "env/project",
    });
    const before = f.saved();
    f.cancel();
    await expect(
      f.client.request({ operation: "connect", workspace: "acme", connectionKey: "env/project" }),
    ).rejects.toThrow();
    expect(f.saved()).toBe(before);
    expect(
      (
        await f.client.request({
          operation: "status",
          workspace: "acme",
          connectionKey: "env/project",
        })
      ).connection?.userId,
    ).toBe("user-1");
  });
  it("rejects a connection to a different workspace", async () => {
    const f = fixture();
    await expect(
      f.client.request({ operation: "connect", workspace: "other", connectionKey: "env/project" }),
    ).rejects.toThrow(/workspace/i);
    expect(f.saved()).toBeNull();
  });
  it("refreshes once for concurrent requests and persists the rotated refresh token", async () => {
    const f = fixture();
    await f.client.request({
      operation: "connect",
      workspace: "acme",
      connectionKey: "env/project",
    });
    f.advance();
    f.setIssues({
      data: {
        viewer: {
          assignedIssues: {
            nodes: [
              {
                id: "i",
                identifier: "ENG-1",
                title: "One",
                url: "https://linear.app/acme/issue/ENG-1",
                branchName: "eng-1-one",
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: "next" },
          },
        },
      },
    });
    const results = await Promise.all(
      [0, 1].map(() =>
        f.client.request({ operation: "issues", workspace: "acme", connectionKey: "env/project" }),
      ),
    );
    expect(f.refreshes()).toBe(1);
    expect(f.saved()).toContain("rotated-refresh");
    expect(results[0]).toMatchObject({
      nextCursor: "next",
      issues: [{ identifier: "ENG-1", workspace: "acme", branchName: "eng-1-one" }],
    });
  });
  it("keeps project bindings separate and removes only the disconnected binding", async () => {
    const f = fixture();
    for (const connectionKey of ["env/one", "env/two"])
      await f.client.request({ operation: "connect", workspace: "acme", connectionKey });
    await f.client.request({
      operation: "disconnect",
      workspace: "acme",
      connectionKey: "env/one",
    });
    expect(
      (await f.client.request({ operation: "status", workspace: "acme", connectionKey: "env/one" }))
        .connection,
    ).toBeNull();
    expect(
      (await f.client.request({ operation: "status", workspace: "acme", connectionKey: "env/two" }))
        .connection?.userId,
    ).toBe("user-1");
  });
  it("searches all workspace issues with a cursor instead of restricting to the viewer", async () => {
    const f = fixture();
    await f.client.request({
      operation: "connect",
      workspace: "acme",
      connectionKey: "env/project",
    });
    f.setIssues({
      data: { searchIssues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    });
    const result = await f.client.request({
      operation: "issues",
      workspace: "acme",
      connectionKey: "env/project",
      query: "login",
      cursor: "page-2",
    });
    const query = JSON.parse(f.calls.at(-1)!.body);
    expect(query.variables).toEqual({ term: "login", after: "page-2" });
    expect(query.query).not.toContain("viewer");
    expect(result.issues).toEqual([]);
  });
  it("can disconnect a saved account even when the new desktop build has no OAuth client ID", async () => {
    const f = fixture();
    const binding = { workspace: "acme", connectionKey: "env/project" };
    await f.client.request({ operation: "connect", ...binding });
    const unconfigured = f.withoutClientId();
    await expect(unconfigured.request({ operation: "disconnect", ...binding })).resolves.toEqual({
      configured: false,
      connection: null,
    });
    expect((await f.client.request({ operation: "status", ...binding })).connection).toBeNull();
  });
});

it("verifies an exact created issue and rejects a mismatched workspace", async () => {
  const f = fixture();
  const input = { workspace: "acme", connectionKey: "env/project" };
  await f.client.request({ ...input, operation: "connect" });
  const issue = {
    id: "created-id",
    identifier: "ENG-1",
    title: "Created",
    url: "https://linear.app/acme/issue/ENG-1",
    branchName: "eng-1-created",
  };
  f.setIssues({ data: { issue, organization: { urlKey: "acme" } } });
  const result = await f.client.request({ ...input, operation: "issue", issueId: issue.id });
  expect(result.issues).toEqual([{ ...issue, workspace: "acme" }]);
  expect(JSON.parse(f.calls.at(-1)!.body).variables).toEqual({ id: issue.id });
  f.setIssues({ data: { issue, organization: { urlKey: "other" } } });
  await expect(
    f.client.request({ ...input, operation: "issue", issueId: issue.id }),
  ).rejects.toThrow("could not be verified");
  f.setIssues({ data: { issue: { ...issue, id: "unrelated" }, organization: { urlKey: "acme" } } });
  await expect(
    f.client.request({ ...input, operation: "issue", issueId: issue.id }),
  ).rejects.toThrow("could not be verified");
});

for (const [view, filter] of [
  ["assigned", { assignee: { id: { eq: "user-1" } } }],
  ["triage", { state: { type: { eq: "triage" } } }],
  ["all", {}],
] as const) {
  it(`filters ${view} issues on the API before pagination, with and without search`, async () => {
    const f = fixture();
    const binding = { workspace: "acme", connectionKey: "env/project" };
    await f.client.request({ ...binding, operation: "connect" });
    const page = { nodes: [], pageInfo: { hasNextPage: true, endCursor: "next" } };
    for (const [term, teamId] of [
      ["", undefined],
      ["login", undefined],
      ["", "team-1"],
      ["login", "team-1"],
    ] as const) {
      f.setIssues({ data: term ? { searchIssues: page } : { issues: page } });
      const input = {
        ...binding,
        operation: "issues",
        view,
        query: term,
        cursor: "page-2",
        ...(teamId ? { teamId } : {}),
      } as LinearDesktopRequest;
      const result = await f.client.request(input);
      const sent = JSON.parse(f.calls.at(-1)!.body);
      expect(sent.variables).toEqual({
        filter: { ...filter, ...(teamId ? { team: { id: { eq: teamId } } } : {}) },
        after: "page-2",
        ...(term ? { term } : {}),
      });
      expect(sent.query).toContain("orderBy: updatedAt");
      expect(sent.query).toContain("filter: $filter");
      expect(result.nextCursor).toBe("next");
      expect(result.issues).toEqual([]);
    }
  });
}

it("loads accessible team pages without exposing credentials", async () => {
  const f = fixture();
  const binding = { workspace: "acme", connectionKey: "env/project" };
  await f.client.request({ ...binding, operation: "connect" });
  const teams = [{ id: "team-1", key: "ENG", name: "Engineering" }];
  f.setIssues({
    data: { teams: { nodes: teams, pageInfo: { hasNextPage: true, endCursor: "teams-next" } } },
  });
  const result = await f.client.request({
    ...binding,
    operation: "teams",
    cursor: "teams-start",
  } as LinearDesktopRequest);
  expect(result).toMatchObject({ teams, nextCursor: "teams-next" });
  expect(JSON.parse(f.calls.at(-1)!.body).variables).toEqual({ after: "teams-start" });
  expect(JSON.stringify(result)).not.toContain("private-");
});
