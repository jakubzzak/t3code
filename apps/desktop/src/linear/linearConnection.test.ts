import type { LinearDesktopRequest } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createLinearConnection, type LinearConnectionDependencies } from "./linearConnection.ts";

const issueState = {
  name: "Testing",
  color: "#4cb782",
  type: "started",
  position: 8.5,
  team: { states: { nodes: [{ position: 8.5 }, { position: -1 }, { position: 2 }] } },
};
const displayState = { name: "Testing", color: "#4cb782", type: "started", progress: 0.75 };

function fixture() {
  let saved: string | null = null;
  const calls: { url: string; body: string }[] = [];
  const authorizations: URL[] = [];
  let cancel = false;
  let now = 0;
  let issueResponse: unknown = null;
  let issuePages: unknown[] = [];
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
      if (issuePages.length && /query (Issues|Search|Assigned)/.test(String(init?.body)))
        return Response.json(issuePages.shift());
      if (issueResponse && String(init?.body).includes("query States"))
        return Response.json(issueResponse);
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
    setPages: (pages: unknown[]) => {
      issuePages = pages;
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
                priority: 1,
                state: issueState,
                assignee: null,
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
      issues: [
        {
          identifier: "ENG-1",
          workspace: "acme",
          branchName: "eng-1-one",
          priority: 1,
          state: displayState,
        },
      ],
    });
    expect(JSON.parse(f.calls.at(-1)!.body).query).toContain("priority");
    expect(JSON.parse(f.calls.at(-1)!.body).query).toContain("state { name color type position");
  });
  it("keeps project bindings separate and removes only the disconnected binding", async () => {
    const f = fixture();
    for (const connectionKey of ["env/one", "env/two"]) {
      await f.client.request({ operation: "connect", workspace: "acme", connectionKey });
    }
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
    priority: 2,
    state: issueState,
    assignee: null,
  };
  f.setIssues({ data: { issue, organization: { urlKey: "acme" } } });
  const result = await f.client.request({ ...input, operation: "issue", issueId: issue.id });
  expect(result.issues).toEqual([{ ...issue, workspace: "acme", state: displayState }]);
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

it.each([
  ["assigned", { assignee: { id: { eq: "user-1" } } }],
  ["triage", { state: { type: { eq: "triage" } } }],
  ["all", {}],
] as const)(
  "filters %s issues on the API before pagination, with and without search",
  async (view, filter) => {
    const f = fixture();
    const binding = { workspace: "acme", connectionKey: "env/project" };
    await f.client.request({ ...binding, operation: "connect" });
    const issue = {
      id: "i",
      identifier: "ENG-1",
      title: "One",
      url: "https://linear.app/acme/issue/ENG-1",
      branchName: "eng-1-one",
      priority: 0,
      state: issueState,
      assignee: null,
    };
    const page = { nodes: [issue], pageInfo: { hasNextPage: true, endCursor: "next" } };
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
      expect(sent.query).toContain("priority");
      expect(sent.query).toContain("state { name color type position");
      expect(result.nextCursor).toBe("next");
      expect(result.issues).toEqual([{ ...issue, workspace: "acme", state: displayState }]);
    }
  },
);

it.each([
  { type: "started", position: -1, progress: 0.25 },
  { type: "started", position: 2, progress: 0.5 },
  { type: "started", position: 8.5, progress: 0.75 },
  { type: "completed", position: 10, progress: 0 },
])(
  "normalizes $type status at position $position without forwarding the team's workflow",
  async ({ type, position, progress }) => {
    const f = fixture();
    const binding = { workspace: "acme", connectionKey: "env/project" };
    await f.client.request({ ...binding, operation: "connect" });
    const issue = {
      id: "i",
      identifier: "ENG-1",
      title: "One",
      url: "https://linear.app/acme/issue/ENG-1",
      branchName: "eng-1-one",
      priority: 1,
      state: { ...issueState, type, position },
      assignee: null,
    };
    f.setIssues({
      data: { issues: { nodes: [issue], pageInfo: { hasNextPage: false, endCursor: null } } },
    });
    const result = await f.client.request({ ...binding, operation: "issues", view: "all" });
    expect(result.issues?.[0]?.state).toEqual({
      name: issueState.name,
      color: issueState.color,
      type,
      progress,
    });
  },
);

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

it("loads actual team workflow statuses across pages", async () => {
  const f = fixture();
  const binding = { workspace: "acme", connectionKey: "env/project" };
  await f.client.request({ ...binding, operation: "connect" });
  const state = {
    id: "testing",
    name: "Testing",
    type: "started",
    color: "#4cb782",
    position: 3,
    team: { id: "team-1", key: "ENG" },
  };
  f.setIssues({
    data: {
      workflowStates: { nodes: [state], pageInfo: { hasNextPage: true, endCursor: "next-state" } },
    },
  });
  const result = await f.client.request({
    ...binding,
    operation: "states",
    teamId: "team-1",
    cursor: "previous",
  });
  expect(result.states).toEqual([state]);
  expect(result.nextCursor).toBe("next-state");
  expect(JSON.parse(f.calls.at(-1)!.body).variables).toEqual({
    after: "previous",
    filter: { team: { id: { eq: "team-1" } } },
  });
});

it("combines status and priority filters with the triage/team scope and returns the assignee", async () => {
  const f = fixture();
  const binding = { workspace: "acme", connectionKey: "env/project" };
  await f.client.request({ ...binding, operation: "connect" });
  const assignee = { name: "Ada", avatarUrl: "https://example.com/ada.png" };
  const issue = {
    id: "i",
    identifier: "ENG-1",
    title: "One",
    url: "https://linear.app/acme/issue/ENG-1",
    branchName: "eng-1",
    priority: 1,
    state: issueState,
    assignee,
  };
  f.setIssues({
    data: { issues: { nodes: [issue], pageInfo: { hasNextPage: false, endCursor: null } } },
  });
  const result = await f.client.request({
    ...binding,
    operation: "issues",
    view: "triage",
    teamId: "team-1",
    stateIds: ["triage-1", "triage-2"],
    priorities: [0, 1],
  });
  expect(result.issues?.[0]?.assignee).toEqual(assignee);
  const sent = JSON.parse(f.calls.at(-1)!.body);
  expect(sent.query).toContain("assignee { name avatarUrl }");
  expect(sent.variables.filter).toEqual({
    state: { type: { eq: "triage" }, id: { in: ["triage-1", "triage-2"] } },
    team: { id: { eq: "team-1" } },
    priority: { in: [0, 1] },
  });
});

it.each(["", "login"])(
  "pages urgency globally, including empty buckets and no priority, for search '%s'",
  async (term) => {
    const f = fixture();
    const binding = { workspace: "acme", connectionKey: "env/project" };
    await f.client.request({ ...binding, operation: "connect" });
    const issue = (id: string, priority: number) => ({
      id,
      identifier: `ENG-${id}`,
      title: `Issue ${id}`,
      url: `https://linear.app/acme/issue/ENG-${id}`,
      branchName: `eng-${id}`,
      priority,
      state: issueState,
      assignee: null,
    });
    const page = (nodes: ReturnType<typeof issue>[], endCursor: string | null = null) => ({
      data: {
        [term ? "searchIssues" : "issues"]: {
          nodes,
          pageInfo: { hasNextPage: endCursor !== null, endCursor },
        },
      },
    });
    f.setPages([
      page([issue("1", 1)], "urgent-next"),
      page([issue("2", 1)]),
      page([]),
      page([issue("3", 0)]),
    ]);
    const input = {
      ...binding,
      operation: "issues" as const,
      view: "assigned" as const,
      sort: "priority" as const,
      query: term,
      teamId: "team-1",
      stateIds: ["testing"],
      priorities: [0, 1, 3] as const,
    };
    const first = await f.client.request(input);
    expect(first.issues?.map((i) => i.id)).toEqual(["1"]);
    const second = await f.client.request({ ...input, cursor: first.nextCursor! });
    expect(second.issues?.map((i) => i.id)).toEqual(["2"]);
    const third = await f.client.request({ ...input, cursor: second.nextCursor! });
    expect(third.issues?.map((i) => i.id)).toEqual(["3"]);
    expect(third.nextCursor).toBeNull();
    const sent = f.calls
      .filter((call) => /query (Issues|Search)/.test(call.body))
      .map((call) => JSON.parse(call.body));
    expect(sent.map((call) => call.variables.filter.priority.in)).toEqual([[1], [1], [3], [0]]);
    expect(sent.map((call) => call.variables.after)).toEqual([null, "urgent-next", null, null]);
    for (const call of sent) {
      expect(call.query).toContain("orderBy: updatedAt");
      expect(call.variables.filter).toMatchObject({
        assignee: { id: { eq: "user-1" } },
        team: { id: { eq: "team-1" } },
        state: { id: { in: ["testing"] } },
      });
      if (term) expect(call.variables.term).toBe(term);
    }
    await expect(
      f.client.request({ ...input, cursor: '{"priority":4,"after":null}' }),
    ).rejects.toThrow("Invalid Linear sort cursor");
  },
);

it("migrates encrypted credentials without changing the original connection and preserves refresh ownership", async () => {
  const crypto = await import("node:crypto");
  const { openLinearConnection } = await import("@t3tools/shared/linearConnectionTransfer");
  const source = fixture();
  const destination = fixture();
  const input = { workspace: "acme", connectionKey: "old-project" };
  await source.client.request({ ...input, operation: "connect" });
  const original = source.saved();
  const pair = crypto.generateKeyPairSync("x25519");
  const exported = await source.client.request({
    ...input,
    operation: "export",
    migrationPublicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  });
  expect(exported.migration).toBeDefined();
  expect(JSON.stringify(exported)).not.toContain("private-access");
  expect(JSON.stringify(exported)).not.toContain("private-refresh");
  expect(source.saved()).toBe(original);
  const credential = openLinearConnection(exported.migration!, pair.privateKey);
  const client = destination.withoutClientId();
  await expect(client.importConnection("new-project", "other", credential)).rejects.toThrow(
    "does not match",
  );
  await client.importConnection("new-project", "acme", credential);
  await expect(client.importConnection("new-project", "acme", credential)).rejects.toThrow(
    "already has",
  );
  expect(
    (await client.request({ operation: "status", workspace: "acme", connectionKey: "new-project" }))
      .connection?.userId,
  ).toBe("user-1");
  destination.advance();
  await client.query("new-project", "acme", "query { viewer { id } }", {});
  expect(destination.refreshes()).toBe(1);
  await client.request({ operation: "connect", workspace: "acme", connectionKey: "new-project" });
  expect(JSON.parse(destination.saved()!)["new-project"].clientId).toBe("test-client");
  const refresh = destination.calls.find((call) => call.url.endsWith("/oauth/token"));
  expect(new URLSearchParams(refresh?.body).get("client_id")).toBe("test-client");
  await expect(client.query("new-project", "acme", "mutation { issueUpdate }", {})).rejects.toThrow(
    "Only Linear reads",
  );
  expect(() =>
    openLinearConnection(
      { ...exported.migration!, tag: Buffer.alloc(16).toString("base64") },
      pair.privateKey,
    ),
  ).toThrow();
});
