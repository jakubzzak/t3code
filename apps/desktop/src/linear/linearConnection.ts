import * as NodeCrypto from "node:crypto";
import {
  LinearConnectionInfo,
  type LinearDesktopRequest,
  type LinearDesktopResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export interface LinearConnectionDependencies {
  clientId: string;
  now: () => number;
  redirectUri: string;
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  fetch: typeof fetch;
  authorize: (url: string, state: string, signal: AbortSignal) => Promise<string>;
}

const Credential = Schema.Struct({
  connection: LinearConnectionInfo,
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.Number,
});
const Credentials = Schema.Record(Schema.String, Credential);
const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
});
const Identity = Schema.Struct({
  data: Schema.Struct({
    viewer: Schema.Struct({ id: Schema.String, name: Schema.String, email: Schema.String }),
    organization: Schema.Struct({ urlKey: Schema.String }),
  }),
});
const IssuePage = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      identifier: Schema.String,
      title: Schema.String,
      url: Schema.String,
      branchName: Schema.String,
    }),
  ),
  pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) }),
});
const Assigned = Schema.Struct({
  data: Schema.Struct({ viewer: Schema.Struct({ assignedIssues: IssuePage }) }),
});
const Search = Schema.Struct({ data: Schema.Struct({ searchIssues: IssuePage }) });
const fields = "nodes { id identifier title url branchName } pageInfo { hasNextPage endCursor }";

const decodeCredentials = Schema.decodeUnknownSync(Credentials);
const decodeToken = Schema.decodeUnknownSync(Token);
const decodeIdentity = Schema.decodeUnknownSync(Identity);
const decodeAssigned = Schema.decodeUnknownSync(Assigned);
const decodeSearch = Schema.decodeUnknownSync(Search);

/** Tokens never cross IPC. The adapter encrypts this document before persisting it. */
export function createLinearConnection(dependencies: LinearConnectionDependencies) {
  let authorization: { controller: AbortController; connectionKey: string } | undefined;
  let queue = Promise.resolve();
  const read = async () => {
    const raw = await dependencies.read();
    if (raw === null) return decodeCredentials({});
    try {
      return decodeCredentials(JSON.parse(raw));
    } catch {
      throw new Error("Unable to read the saved Linear connection. Reconnect Linear.");
    }
  };
  const token = async (body: URLSearchParams) => {
    const response = await dependencies.fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Linear authorization expired or failed. Reconnect Linear.");
    try {
      return decodeToken(await response.json());
    } catch {
      throw new Error("Linear returned an invalid authorization response.");
    }
  };
  const graphql = async (accessToken: string, query: string, variables = {}) => {
    const response = await dependencies.fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401) throw new Error("Linear authorization expired. Reconnect Linear.");
    if (response.status === 429)
      throw new Error("Linear is rate limiting requests. Try again shortly.");
    if (!response.ok) throw new Error("Unable to reach Linear. Try again.");
    return response.json();
  };
  const request = async (input: LinearDesktopRequest): Promise<LinearDesktopResult> => {
    const configured = dependencies.clientId.length > 0;
    const credentials = await read();
    let credential = credentials[input.connectionKey];
    if (credential?.connection.workspace !== input.workspace) credential = undefined;
    const result = () => ({ configured, connection: credential?.connection ?? null });
    if (input.operation === "status") return result();
    if (!configured && input.operation !== "disconnect")
      throw new Error("This desktop build has no Linear OAuth application configured.");
    if (input.operation === "connect") {
      const controller = new AbortController();
      authorization = { controller, connectionKey: input.connectionKey };
      try {
        const verifier = NodeCrypto.randomBytes(32).toString("base64url");
        const state = NodeCrypto.randomBytes(32).toString("base64url");
        const url = new URL("https://linear.app/oauth/authorize");
        url.search = new URLSearchParams({
          client_id: dependencies.clientId,
          redirect_uri: dependencies.redirectUri,
          response_type: "code",
          scope: "read",
          actor: "user",
          state,
          code_challenge: NodeCrypto.createHash("sha256").update(verifier).digest("base64url"),
          code_challenge_method: "S256",
        }).toString();
        const code = await dependencies.authorize(url.href, state, controller.signal);
        controller.signal.throwIfAborted();
        const tokens = await token(
          new URLSearchParams({
            client_id: dependencies.clientId,
            redirect_uri: dependencies.redirectUri,
            grant_type: "authorization_code",
            code,
            code_verifier: verifier,
          }),
        );
        let identity;
        try {
          identity = decodeIdentity(
            await graphql(
              tokens.access_token,
              "query { viewer { id name email } organization { urlKey } }",
            ),
          );
        } catch {
          throw new Error(
            "Unable to verify the Linear account and workspace. Try connecting again.",
          );
        }
        if (identity.data.organization.urlKey !== input.workspace)
          throw new Error("The authorized Linear workspace does not match this project.");
        controller.signal.throwIfAborted();
        credential = {
          connection: {
            workspace: input.workspace,
            userId: identity.data.viewer.id,
            name: identity.data.viewer.name,
            email: identity.data.viewer.email,
          },
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: dependencies.now() + tokens.expires_in * 1000,
        };
        await dependencies.write(
          JSON.stringify({ ...credentials, [input.connectionKey]: credential }),
        );
        return result();
      } finally {
        if (authorization?.controller === controller) authorization = undefined;
      }
    }
    if (input.operation === "disconnect") {
      const next = { ...credentials };
      delete next[input.connectionKey];
      await dependencies.write(JSON.stringify(next));
      if (credential) {
        try {
          const response = await dependencies.fetch("https://api.linear.app/oauth/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: credential.refreshToken,
              token_type_hint: "refresh_token",
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok && response.status !== 400) throw new Error();
        } catch {
          throw new Error(
            "Disconnected locally, but Linear revocation failed. Revoke T3 Code in Linear’s application settings.",
          );
        }
      }
      return { configured, connection: null };
    }
    if (!credential)
      throw new Error("Connect Linear in this project's integration settings first.");
    if (credential.expiresAt <= dependencies.now() + 60_000) {
      const tokens = await token(
        new URLSearchParams({
          client_id: dependencies.clientId,
          grant_type: "refresh_token",
          refresh_token: credential.refreshToken,
        }),
      );
      credential = {
        ...credential,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: dependencies.now() + tokens.expires_in * 1000,
      };
      await dependencies.write(
        JSON.stringify({ ...credentials, [input.connectionKey]: credential }),
      );
    }
    const term = input.query?.trim();
    const data = await graphql(
      credential.accessToken,
      term
        ? `query Search($term: String!, $after: String) { searchIssues(term: $term, first: 50, after: $after) { ${fields} } }`
        : `query Assigned($after: String) { viewer { assignedIssues(first: 50, after: $after) { ${fields} } } }`,
      { ...(term ? { term } : {}), after: input.cursor ?? null },
    );
    try {
      const page = term
        ? decodeSearch(data).data.searchIssues
        : decodeAssigned(data).data.viewer.assignedIssues;
      return {
        ...result(),
        issues: page.nodes.map((issue) => ({ ...issue, workspace: input.workspace })),
        nextCursor: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
      };
    } catch {
      throw new Error("Linear could not load issues. Try again or reconnect Linear.");
    }
  };
  return {
    request: (input: LinearDesktopRequest): Promise<LinearDesktopResult> => {
      if (input.operation === "cancel") {
        if (authorization?.connectionKey === input.connectionKey) authorization.controller.abort();
        return Promise.resolve({ configured: dependencies.clientId.length > 0, connection: null });
      }
      // Serialize rotating refresh tokens and encrypted document updates across windows.
      const pending = queue.then(() => request(input));
      queue = pending.then(
        () => {},
        () => {},
      );
      return pending;
    },
  };
}
