// @effect-diagnostics nodeBuiltinImport:off -- Environment-owned PKCE and one-time encrypted credential migration.
import * as NodeCrypto from "node:crypto";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import {
  InboxError,
  InboxReplyError,
  type InboxReplyMessage,
  type ProjectId,
  type InboxSourceItem,
  type LinearDesktopRequest,
  type LinearDesktopResult,
  type LinearConnectionEnvelope,
} from "@t3tools/contracts";
import { createLinearConnection } from "@t3tools/shared/linearConnection";
import { openLinearConnection } from "@t3tools/shared/linearConnectionTransfer";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Settings from "../serverSettings.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import { readLinearInbox, readLinearIssue } from "../inbox/connectors/linear.ts";

declare const __T3CODE_BUILD_LINEAR_CLIENT_ID__: string | undefined;
export const LINEAR_CALLBACK_PATH = "/oauth/linear/callback";
const isReplyError = Schema.is(InboxReplyError);
const secretKey = (id: ProjectId) => `inbox-linear-${encodeURIComponent(id)}`;
export class LinearConnection extends Context.Service<
  LinearConnection,
  {
    readonly createComment: (
      projectId: ProjectId,
      connectionId: string,
      input: { issueId: string; parentId: string | null; body: string },
    ) => Effect.Effect<InboxReplyMessage, InboxReplyError>;
    readonly request: (
      projectId: ProjectId,
      input: LinearDesktopRequest,
    ) => Effect.Effect<LinearDesktopResult, InboxError>;
    readonly begin: (projectId: ProjectId, origin: string) => Effect.Effect<string, InboxError>;
    readonly complete: (state: string, code: string) => Effect.Effect<void, InboxError>;
    readonly cancel: (projectId: ProjectId) => Effect.Effect<void, InboxError>;
    readonly disconnect: (projectId: ProjectId) => Effect.Effect<void, InboxError>;
    readonly prepareMigration: (
      projectId: ProjectId,
    ) => Effect.Effect<{ ticket: string; publicKey: string }, InboxError>;
    readonly importMigration: (
      projectId: ProjectId,
      ticket: string,
      envelope: LinearConnectionEnvelope,
    ) => Effect.Effect<void, InboxError>;
    readonly read: (
      projectId: ProjectId,
      categories: ReadonlyArray<string>,
      since: string,
      tracked?: ReadonlyArray<Pick<InboxSourceItem, "connectionId" | "groupId">>,
    ) => Effect.Effect<Awaited<ReturnType<typeof readLinearInbox>>, InboxError>;
    readonly readIssue: (
      projectId: ProjectId,
      issueId: string,
      includeComments: boolean,
    ) => Effect.Effect<Awaited<ReturnType<typeof readLinearIssue>>, InboxError>;
  }
>()("t3/linear/LinearConnection") {}
export const layer = Layer.effect(
  LinearConnection,
  Effect.gen(function* () {
    const secrets = yield* Secrets.ServerSecretStore;
    const settings = yield* Settings.ServerSettingsService;
    const clock = yield* Clock.Clock;
    const scope = yield* Effect.scope;
    const context = yield* Effect.context<never>();
    const run = Effect.runPromiseWith(context);
    const clientId = yield* Config.String("T3CODE_LINEAR_CLIENT_ID").pipe(
      Config.withDefault(
        typeof __T3CODE_BUILD_LINEAR_CLIENT_ID__ === "undefined"
          ? ""
          : (__T3CODE_BUILD_LINEAR_CLIENT_ID__ ?? ""),
      ),
    );
    const clients = new Map<
      ProjectId,
      { clientId: string; client: ReturnType<typeof createLinearConnection> }
    >();
    const flows = new Map<
      string,
      { projectId: ProjectId; accept: (code: string) => void; finished: Promise<void> }
    >();
    const connecting = new Map<
      ProjectId,
      { url: Promise<string>; status: LinearDesktopResult; finished: Promise<void> }
    >();
    const beginLocks = new Map<ProjectId, Semaphore.Semaphore>();
    const beginLock = (projectId: ProjectId) => {
      let lock = beginLocks.get(projectId);
      if (!lock) {
        lock = Semaphore.makeUnsafe(1);
        beginLocks.set(projectId, lock);
      }
      return lock.withPermits(1);
    };
    const errors = new Map<ProjectId, string>();
    const transfers = new Map<
      string,
      { projectId: ProjectId; privateKey: NodeCrypto.KeyObject; expiresAt: number }
    >();
    const wrap = (cause: unknown) =>
      new InboxError({
        detail: cause instanceof Error ? cause.message : "Linear connection failed. Try again.",
      });
    const projectConfiguration = (projectId: ProjectId) =>
      settings.getSettings.pipe(
        Effect.map((value) => resolveProjectSettings(value, projectId).settings),
        Effect.mapError(
          () => new InboxError({ detail: "Could not read the project's Linear workspace." }),
        ),
      );
    const authorizations = new Map<
      ProjectId,
      { origin: string; ready: (url: string) => void; finished: Promise<void> }
    >();
    const getClient = (
      projectId: ProjectId,
      configuredClientId: string,
      authorization?: { origin: string; ready: (url: string) => void; finished: Promise<void> },
    ) => {
      if (authorization) authorizations.set(projectId, authorization);
      const cached = clients.get(projectId);
      const effectiveClientId = configuredClientId || clientId;
      if (cached && (cached.clientId === effectiveClientId || connecting.has(projectId)))
        return cached.client;
      const client = createLinearConnection({
        clientId: effectiveClientId,
        scopes: "read,comments:create",
        get redirectUri() {
          return new URL(
            LINEAR_CALLBACK_PATH,
            authorizations.get(projectId)?.origin ?? "http://127.0.0.1",
          ).toString();
        },
        now: () => clock.currentTimeMillisUnsafe(),
        fetch: globalThis.fetch,
        read: () =>
          run(secrets.get(secretKey(projectId))).then((value) =>
            Option.isSome(value) ? new TextDecoder().decode(value.value) : null,
          ),
        write: (value) => run(secrets.set(secretKey(projectId), new TextEncoder().encode(value))),
        authorize: (url, state, signal) =>
          new Promise<string>((resolve, reject) => {
            const authorization = authorizations.get(projectId);
            if (!authorization) {
              reject(new Error("Start Linear authorization from Integrations."));
              return;
            }
            const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]);
            const cleanup = () => {
              flows.delete(state);
              abortSignal.removeEventListener("abort", abort);
            };
            const abort = () => {
              cleanup();
              reject(new Error("Linear sign-in was cancelled or expired. Connect again."));
            };
            if (abortSignal.aborted) {
              abort();
              return;
            }
            abortSignal.addEventListener("abort", abort, { once: true });
            flows.set(state, {
              projectId,
              finished: authorization.finished,
              accept: (code) => {
                cleanup();
                resolve(code);
              },
            });
            authorization.ready(url);
          }),
      });
      clients.set(projectId, { clientId: effectiveClientId, client });
      return client;
    };
    const request = (projectId: ProjectId, input: LinearDesktopRequest) =>
      Effect.gen(function* () {
        const { linearWorkspace: slug, linearClientId } = yield* projectConfiguration(projectId);
        if (!slug || slug !== input.workspace)
          return yield* new InboxError({
            detail: "Set this project's Linear workspace in Integrations.",
          });
        if (!["status", "issues", "issue", "teams", "states"].includes(input.operation))
          return yield* new InboxError({
            detail: "Use the project connection controls for authorization.",
          });
        if (input.operation === "status" && connecting.has(projectId))
          return connecting.get(projectId)!.status;
        if (input.operation === "status" && errors.has(projectId))
          return yield* new InboxError({ detail: errors.get(projectId)! });
        return yield* Effect.tryPromise({
          try: () =>
            getClient(projectId, linearClientId).request({
              ...input,
              connectionKey: projectId,
              workspace: slug,
            }),
          catch: wrap,
        });
      });
    return LinearConnection.of({
      createComment: (projectId, connectionId, input) =>
        Effect.gen(function* () {
          const { linearWorkspace, linearClientId } = yield* projectConfiguration(projectId).pipe(
            Effect.mapError(() => new InboxReplyError({ reason: "permission" })),
          );
          return yield* Effect.tryPromise({
            try: () =>
              getClient(projectId, linearClientId).createComment(
                projectId,
                linearWorkspace,
                connectionId,
                input,
              ),
            catch: (error) =>
              isReplyError(error) ? error : new InboxReplyError({ reason: "permission" }),
          });
        }),
      request,
      begin: (projectId, origin) =>
        beginLock(projectId)(
          Effect.gen(function* () {
            if (connecting.has(projectId))
              return yield* Effect.tryPromise({
                try: () => connecting.get(projectId)!.url,
                catch: wrap,
              });
            const { linearWorkspace: slug, linearClientId } =
              yield* projectConfiguration(projectId);
            if (!slug)
              return yield* new InboxError({
                detail: "Set this project's Linear workspace first.",
              });
            errors.delete(projectId);
            const status = yield* request(projectId, {
              operation: "status",
              workspace: slug,
              connectionKey: projectId,
            });
            let ready!: (url: string) => void;
            let failed!: (error: unknown) => void;
            const url = new Promise<string>((resolve, reject) => {
              ready = resolve;
              failed = reject;
            });
            let finish!: () => void;
            const finished = new Promise<void>((resolve) => {
              finish = resolve;
            });
            const client = getClient(projectId, linearClientId, { origin, ready, finished });
            connecting.set(projectId, { url, status, finished });
            yield* Effect.tryPromise({
              try: () =>
                client.request({ operation: "connect", workspace: slug, connectionKey: projectId }),
              catch: wrap,
            }).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  errors.set(projectId, error.detail);
                  failed(error);
                }),
              ),
              Effect.ensuring(
                Effect.sync(() => {
                  connecting.delete(projectId);
                  finish();
                }),
              ),
              Effect.forkIn(scope),
            );
            return yield* Effect.tryPromise({ try: () => url, catch: wrap });
          }),
        ),
      complete: (state, code) =>
        Effect.gen(function* () {
          const flow = flows.get(state);
          if (!flow)
            return yield* new InboxError({
              detail: "Linear sign-in expired or was already used. Connect again.",
            });
          flow.accept(code);
          yield* Effect.promise(() => flow.finished);
          if (errors.has(flow.projectId))
            return yield* new InboxError({ detail: errors.get(flow.projectId)! });
        }),
      cancel: (projectId) =>
        Effect.gen(function* () {
          const pending = connecting.get(projectId);
          const { linearWorkspace: slug, linearClientId } = yield* projectConfiguration(projectId);
          yield* Effect.tryPromise({
            try: () =>
              getClient(projectId, linearClientId).request({
                operation: "cancel",
                workspace: slug,
                connectionKey: projectId,
              }),
            catch: wrap,
          });
          if (pending) yield* Effect.promise(() => pending.finished);
          errors.delete(projectId);
        }).pipe(Effect.asVoid),
      disconnect: (projectId) =>
        Effect.gen(function* () {
          const { linearWorkspace: slug, linearClientId } = yield* projectConfiguration(projectId);
          const client = getClient(projectId, linearClientId);
          yield* Effect.tryPromise({
            try: () =>
              client.request({ operation: "cancel", workspace: slug, connectionKey: projectId }),
            catch: wrap,
          });
          errors.delete(projectId);
          yield* Effect.tryPromise({
            try: () =>
              client.request({
                operation: "disconnect",
                workspace: slug,
                connectionKey: projectId,
              }),
            catch: wrap,
          });
        }).pipe(Effect.asVoid),
      prepareMigration: (projectId) =>
        Effect.sync(() => {
          const now = clock.currentTimeMillisUnsafe();
          for (const [ticket, value] of transfers)
            if (value.expiresAt <= now || value.projectId === projectId) transfers.delete(ticket);
          const { publicKey, privateKey } = NodeCrypto.generateKeyPairSync("x25519");
          const ticket = NodeCrypto.randomBytes(32).toString("base64url");
          transfers.set(ticket, { projectId, privateKey, expiresAt: now + 10 * 60_000 });
          return {
            ticket,
            publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
          };
        }),
      importMigration: (projectId, ticket, envelope) =>
        Effect.gen(function* () {
          const transfer = transfers.get(ticket);
          if (
            !transfer ||
            transfer.projectId !== projectId ||
            transfer.expiresAt <= (yield* Clock.currentTimeMillis)
          )
            return yield* new InboxError({
              detail: "This migration expired or belongs to another project. Start it again.",
            });
          transfers.delete(ticket);
          const { linearWorkspace: slug, linearClientId } = yield* projectConfiguration(projectId);
          const credential = yield* Effect.try({
            try: () => openLinearConnection(envelope, transfer.privateKey),
            catch: () =>
              new InboxError({ detail: "The encrypted Linear connection could not be migrated." }),
          });
          yield* Effect.tryPromise({
            try: () =>
              getClient(projectId, linearClientId).importConnection(projectId, slug, credential),
            catch: wrap,
          });
          errors.delete(projectId);
        }),
      readIssue: (projectId, issueId, includeComments) =>
        Effect.gen(function* () {
          const { linearWorkspace: slug, linearClientId } = yield* projectConfiguration(projectId);
          return yield* Effect.tryPromise({
            try: () =>
              readLinearIssue(
                (query, variables) =>
                  getClient(projectId, linearClientId).query(projectId, slug, query, variables),
                issueId,
                includeComments,
              ),
            catch: wrap,
          });
        }),
      read: (projectId, categories, since, tracked) =>
        Effect.gen(function* () {
          const { linearWorkspace: slug, linearClientId } = yield* projectConfiguration(projectId);
          return yield* Effect.tryPromise({
            try: () =>
              readLinearInbox(
                (query, variables) =>
                  getClient(projectId, linearClientId).query(projectId, slug, query, variables),
                categories,
                since,
                tracked,
              ),
            catch: wrap,
          });
        }),
    });
  }),
);
