import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { InboxError, type InboxSourceItem, type ProjectId } from "@t3tools/contracts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import { superhumanOAuthProvider, type SuperhumanCredentials } from "./superhumanOAuth.ts";
import {
  readSuperhumanInbox,
  SUPERHUMAN_READ_TOOLS,
  type SuperhumanRead,
} from "./connectors/superhuman.ts";
const URL_MCP = "https://mcp.mail.superhuman.com/mcp";
export const SUPERHUMAN_CALLBACK_PATH = "/oauth/inbox/superhuman/callback";
const Credentials = Schema.Struct({
  redirectUrl: Schema.String,
  client: Schema.optionalKey(Schema.Unknown),
  tokens: Schema.optionalKey(Schema.Unknown),
  verifier: Schema.optionalKey(Schema.String),
});
const decodeCredentials = Schema.decodeUnknownEffect(Schema.fromJsonString(Credentials));
const encodeCredentials = Schema.encodeEffect(Schema.fromJsonString(Credentials));
const key = (projectId: ProjectId) => `inbox-superhuman-${encodeURIComponent(projectId)}`;
const Accounts = Schema.Struct({
  accounts: Schema.NullOr(Schema.Array(Schema.Struct({ accountEmail: Schema.String }))),
});
const Splits = Schema.Struct({
  splits: Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }))),
});
const Labels = Schema.Struct({ labels: Schema.NullOr(Schema.Array(Schema.String)) });
const decodeAccounts = Schema.decodeUnknownSync(Accounts);
const decodeSplits = Schema.decodeUnknownSync(Splits);
const decodeLabels = Schema.decodeUnknownSync(Labels);
export interface SuperhumanCatalog {
  accounts: ReadonlyArray<string>;
  splits: ReadonlyArray<{ accountEmail: string; id: string; name: string }>;
  labels: ReadonlyArray<{ accountEmail: string; name: string }>;
}
export class SuperhumanConnection extends Context.Service<
  SuperhumanConnection,
  {
    readonly begin: (projectId: ProjectId, origin: string) => Effect.Effect<string, InboxError>;
    readonly complete: (state: string, code: string) => Effect.Effect<ProjectId, InboxError>;
    readonly disconnect: (projectId: ProjectId) => Effect.Effect<void, InboxError>;
    readonly read: (
      projectId: ProjectId,
      accounts: ReadonlyArray<string>,
      categories: ReadonlyArray<string>,
      since: string,
    ) => Effect.Effect<ReadonlyArray<InboxSourceItem>, InboxError>;
    readonly catalog: (projectId: ProjectId) => Effect.Effect<SuperhumanCatalog, InboxError>;
  }
>()("t3/inbox/SuperhumanConnection") {}
const make = Effect.gen(function* () {
  const secrets = yield* Secrets.ServerSecretStore;
  const crypto = yield* Crypto.Crypto;
  const services = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(services);
  const pending = new Map<
    string,
    { projectId: ProjectId; expiresAt: number; credentials: SuperhumanCredentials }
  >();
  const locks = new Map<ProjectId, Semaphore.Semaphore>();
  const lock = <A>(projectId: ProjectId, work: Effect.Effect<A, InboxError>) =>
    Effect.gen(function* () {
      let semaphore = locks.get(projectId);
      if (!semaphore) {
        semaphore = yield* Semaphore.make(1);
        locks.set(projectId, semaphore);
      }
      return yield* semaphore.withPermits(1)(work);
    });
  const persist = (projectId: ProjectId, credentials: SuperhumanCredentials) =>
    encodeCredentials(credentials).pipe(
      Effect.flatMap((json) => secrets.set(key(projectId), new TextEncoder().encode(json))),
      Effect.mapError(
        () => new InboxError({ detail: "Could not securely save the Superhuman connection." }),
      ),
    );
  const withClient = <A>(projectId: ProjectId, use: (read: SuperhumanRead) => Promise<A>) =>
    lock(
      projectId,
      Effect.gen(function* () {
        const stored = yield* secrets
          .get(key(projectId))
          .pipe(
            Effect.mapError(
              () => new InboxError({ detail: "Could not read the Superhuman connection." }),
            ),
          );
        if (Option.isNone(stored))
          return yield* new InboxError({
            detail: "Connect Superhuman in this project's Integrations settings.",
          });
        const credentials = yield* decodeCredentials(new TextDecoder().decode(stored.value)).pipe(
          Effect.mapError(
            () =>
              new InboxError({ detail: "Reconnect Superhuman to repair its saved connection." }),
          ),
        );
        return yield* Effect.tryPromise({
          try: async (signal) => {
            const provider = superhumanOAuthProvider({
              credentials,
              state: "",
              save: (next) => runPromise(persist(projectId, next)),
              redirect: () => {
                throw new Error("Superhuman authorization expired. Reconnect in Integrations.");
              },
            });
            const client = new Client(
              { name: "Blackbird Inbox", version: "1" },
              { capabilities: {} },
            );
            const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
              authProvider: provider,
            });
            const abort = () => {
              void client.close().catch(() => {});
            };
            signal.addEventListener("abort", abort, { once: true });
            try {
              // SDK 1.29 widens this optional getter under exactOptionalPropertyTypes.
              const protocolTransport: Omit<StreamableHTTPClientTransport, "sessionId"> = transport;
              await client.connect(protocolTransport);
              return await use(async (name, arguments_) => {
                if (!SUPERHUMAN_READ_TOOLS.has(name))
                  throw new Error("Inbox only allows supported Superhuman read tools.");
                const result = await client.callTool({ name, arguments: arguments_ });
                if (result.isError)
                  throw new Error(
                    `Superhuman ${name} failed. Check account access in Integrations.`,
                  );
                if (result.structuredContent) return result.structuredContent;
                const content = result.content;
                if (!Array.isArray(content))
                  throw new Error("Superhuman returned no structured result.");
                const text = content
                  .filter(
                    (item): item is { type: "text"; text: string } =>
                      item.type === "text" && typeof item.text === "string",
                  )
                  .map((item) => item.text)
                  .join("\n");
                return JSON.parse(text) as unknown;
              });
            } finally {
              signal.removeEventListener("abort", abort);
              await client.close();
            }
          },
          catch: () =>
            new InboxError({
              detail:
                "Superhuman could not be read. Reconnect or check account permissions in Integrations.",
            }),
        });
      }),
    );
  return SuperhumanConnection.of({
    begin: (projectId, origin) =>
      lock(
        projectId,
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          for (const [state, flow] of pending)
            if (flow.projectId === projectId || flow.expiresAt <= now) pending.delete(state);
          const nonce = Buffer.from(
            yield* crypto
              .randomBytes(32)
              .pipe(
                Effect.mapError(() => new InboxError({ detail: "Could not start authorization." })),
              ),
          ).toString("base64url");
          const redirectUrl = new URL(SUPERHUMAN_CALLBACK_PATH, origin).toString();
          const flow = {
            projectId,
            expiresAt: now + 15 * 60_000,
            credentials: { redirectUrl } as SuperhumanCredentials,
          };
          let authorizeUrl = "";
          const provider = superhumanOAuthProvider({
            credentials: flow.credentials,
            state: nonce,
            save: async (value) => {
              flow.credentials = value;
            },
            redirect: (url) => {
              authorizeUrl = String(url);
            },
          });
          yield* Effect.tryPromise({
            try: () => auth(provider, { serverUrl: URL_MCP }),
            catch: () =>
              new InboxError({
                detail:
                  "Superhuman authorization could not start. Check your connection and try again.",
              }),
          });
          if (!authorizeUrl)
            return yield* new InboxError({
              detail: "Superhuman did not provide an authorization link.",
            });
          pending.set(nonce, flow);
          return authorizeUrl;
        }),
      ),
    complete: (state, code) =>
      Effect.gen(function* () {
        const flow = pending.get(state);
        if (!flow || flow.expiresAt <= (yield* Clock.currentTimeMillis))
          return yield* new InboxError({
            detail: "This authorization attempt expired or was already used. Connect again.",
          });
        return yield* lock(
          flow.projectId,
          Effect.gen(function* () {
            if (pending.get(state) !== flow || flow.expiresAt <= (yield* Clock.currentTimeMillis))
              return yield* new InboxError({
                detail: "This authorization attempt expired or was cancelled. Connect again.",
              });
            pending.delete(state);
            const provider = superhumanOAuthProvider({
              credentials: flow.credentials,
              state,
              save: async (value) => {
                flow.credentials = value;
              },
              redirect: () => {},
            });
            const result = yield* Effect.tryPromise({
              try: () => auth(provider, { serverUrl: URL_MCP, authorizationCode: code }),
              catch: () =>
                new InboxError({ detail: "Superhuman authorization failed. Connect again." }),
            });
            if (result !== "AUTHORIZED")
              return yield* new InboxError({ detail: "Superhuman authorization did not finish." });
            yield* persist(flow.projectId, flow.credentials);
            return flow.projectId;
          }),
        );
      }),
    disconnect: (projectId) =>
      lock(
        projectId,
        Effect.gen(function* () {
          for (const [state, flow] of pending)
            if (flow.projectId === projectId) pending.delete(state);
          yield* secrets
            .remove(key(projectId))
            .pipe(
              Effect.mapError(
                () => new InboxError({ detail: "Could not remove the Superhuman connection." }),
              ),
            );
        }),
      ),
    read: (projectId, accounts, categories, since) =>
      withClient(projectId, (read) => readSuperhumanInbox(read, accounts, categories, since)),
    catalog: (projectId) =>
      withClient(projectId, async (read) => {
        const accounts = decodeAccounts(await read("list_accounts", {})).accounts ?? [];
        const results = await Promise.all(
          accounts.map(async ({ accountEmail }) => {
            const [splits, labels] = await Promise.all([
              read("list_splits", { acting_email: accountEmail }),
              read("list_labels", { acting_email: accountEmail }),
            ]);
            return {
              splits: (decodeSplits(splits).splits ?? []).map((split) => ({
                ...split,
                accountEmail,
              })),
              labels: (decodeLabels(labels).labels ?? []).map((name) => ({ name, accountEmail })),
            };
          }),
        );
        return {
          accounts: accounts.map((account) => account.accountEmail),
          splits: results.flatMap((result) => result.splits),
          labels: results.flatMap((result) => result.labels),
        };
      }),
  });
});
export const layer = Layer.effect(SuperhumanConnection, make);
