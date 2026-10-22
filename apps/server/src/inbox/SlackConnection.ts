// @effect-diagnostics nodeBuiltinImport:off -- OAuth PKCE uses Node's cryptographic random and SHA-256 primitives.
import * as NodeCrypto from "node:crypto";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { InboxError, type ProjectId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Settings from "../serverSettings.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";

export const SLACK_CALLBACK_PATH = "/oauth/inbox/slack/callback";
const READ_SCOPES =
  "im:read,im:history,mpim:read,mpim:history,search:read,usergroups:read,users:read,channels:history,groups:history";
const credentialKey = (projectId: ProjectId) => `inbox-slack-${encodeURIComponent(projectId)}`;
const Tokens = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
});
const OAuthResponse = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
  authed_user: Schema.optionalKey(Schema.Struct({ ...Tokens.fields, id: Schema.String })),
  access_token: Schema.optionalKey(Schema.String),
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
  team: Schema.optionalKey(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
const Credential = Schema.Struct({
  clientId: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.optionalKey(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  account: Schema.String,
});
const decodeCredential = Schema.decodeUnknownSync(Schema.fromJsonString(Credential));
const decodeResponse = Schema.decodeUnknownSync(OAuthResponse);
const fail = (detail: string) => new InboxError({ detail });

/** Only known Slack error codes are safe to show; never echo OAuth payloads or descriptions. */
function authorizationFailure(error: string | undefined) {
  switch (error) {
    case "pkce_not_allowed":
      return fail(
        "Slack rejected authorization (pkce_not_allowed). Enable PKCE in the Slack app's OAuth & Permissions settings, then start a new connection.",
      );
    case "bad_client_secret":
      return fail(
        "Slack rejected authorization (bad_client_secret). Blackbird uses PKCE without a client secret. Check that PKCE is enabled for the configured Slack app, then connect again.",
      );
    case "invalid_client_id":
      return fail(
        "Slack rejected authorization (invalid_client_id). Check this project's Slack OAuth client ID and connect again.",
      );
    case "bad_redirect_uri":
      return fail(
        "Slack rejected authorization (bad_redirect_uri). The callback URL must match the address used to start sign-in. Start a new connection from Blackbird.",
      );
    case "invalid_code_verifier":
      return fail(
        "Slack rejected authorization (invalid_code_verifier). The PKCE verification failed. Start a new connection from Blackbird and use its latest sign-in link.",
      );
    case "invalid_code":
      return fail(
        "Slack rejected authorization (invalid_code). The sign-in code is invalid, expired, or already used. Start a new connection instead of reloading the callback page.",
      );
    case "invalid_refresh_token":
      return fail(
        "Slack rejected authorization (invalid_refresh_token). The saved authorization can no longer be refreshed. Reconnect Slack in this project's Integrations settings.",
      );
    case "access_denied":
      return fail(
        "Slack rejected authorization (access_denied). Check your workspace's app permissions and connect again.",
      );
    case "ratelimited":
      return fail(
        "Slack rejected authorization (ratelimited). Wait before trying to connect again.",
      );
    default:
      return fail(
        "Slack rejected authorization. Check the app's OAuth settings and start a new connection from Blackbird.",
      );
  }
}

export class SlackConnection extends Context.Service<
  SlackConnection,
  {
    readonly begin: (projectId: ProjectId, origin: string) => Effect.Effect<string, InboxError>;
    readonly complete: (
      state: string,
      code: string,
    ) => Effect.Effect<{ projectId: ProjectId; account: string }, InboxError>;
    readonly cancel: (projectId: ProjectId) => Effect.Effect<void>;
    readonly disconnect: (projectId: ProjectId) => Effect.Effect<void, InboxError>;
    readonly accessToken: (projectId: ProjectId) => Effect.Effect<string, InboxError>;
  }
>()("t3/inbox/SlackConnection") {}

export const layer = Layer.effect(
  SlackConnection,
  Effect.gen(function* () {
    const secrets = yield* Secrets.ServerSecretStore;
    const settings = yield* Settings.ServerSettingsService;
    const http = yield* HttpClient.HttpClient;
    const clock = yield* Clock.Clock;
    const pending = new Map<
      string,
      {
        projectId: ProjectId;
        clientId: string;
        redirectUri: string;
        verifier: string;
        expiresAt: number;
      }
    >();
    const locks = new Map<ProjectId, Semaphore.Semaphore>();
    const lock = (projectId: ProjectId) => {
      let value = locks.get(projectId);
      if (!value) {
        value = Semaphore.makeUnsafe(1);
        locks.set(projectId, value);
      }
      return value.withPermits(1);
    };
    const cancel = (projectId: ProjectId) =>
      Effect.sync(() => {
        for (const [state, flow] of pending)
          if (flow.projectId === projectId) pending.delete(state);
      });
    const exchange = (params: Record<string, string>) =>
      Effect.gen(function* () {
        const response = yield* http
          .execute(
            HttpClientRequest.post("https://slack.com/api/oauth.v2.access").pipe(
              HttpClientRequest.bodyUrlParams(params),
            ),
          )
          .pipe(
            Effect.mapError(() =>
              fail("Slack authorization could not reach Slack. Connect again."),
            ),
          );
        if (response.status !== 200)
          return yield* fail(
            `Slack authorization request failed (HTTP ${response.status}). Try connecting again later.`,
          );
        const data = yield* response.json.pipe(
          Effect.mapError(() => fail("Slack returned an invalid authorization response.")),
        );
        const result = yield* Effect.try({
          try: () => decodeResponse(data),
          catch: () => fail("Slack returned an invalid authorization response."),
        });
        if (!result.ok) return yield* authorizationFailure(result.error);
        return result;
      }).pipe(
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () => fail("Slack authorization timed out waiting for Slack. Connect again."),
        }),
      );
    const save = (projectId: ProjectId, credential: typeof Credential.Type) =>
      secrets
        .set(credentialKey(projectId), new TextEncoder().encode(JSON.stringify(credential)))
        .pipe(
          Effect.mapError(() => fail("Could not save the Slack connection on this environment.")),
        );
    return SlackConnection.of({
      begin: (projectId, origin) =>
        lock(projectId)(
          Effect.gen(function* () {
            const config = resolveProjectSettings(
              yield* settings.getSettings.pipe(
                Effect.mapError(() =>
                  fail("Could not read the project's Slack application settings."),
                ),
              ),
              projectId,
            ).settings;
            if (!config.slackClientId)
              return yield* fail("Enter this project's Slack OAuth client ID first.");
            yield* cancel(projectId);
            const now = clock.currentTimeMillisUnsafe();
            for (const [state, flow] of pending) if (flow.expiresAt <= now) pending.delete(state);
            const state = NodeCrypto.randomBytes(32).toString("base64url");
            const verifier = NodeCrypto.randomBytes(32).toString("base64url");
            const redirectUri = new URL(SLACK_CALLBACK_PATH, origin).toString();
            pending.set(state, {
              projectId,
              clientId: config.slackClientId,
              redirectUri,
              verifier,
              expiresAt: now + 15 * 60_000,
            });
            const url = new URL("https://slack.com/oauth/v2/authorize");
            url.search = new URLSearchParams({
              client_id: config.slackClientId,
              user_scope: READ_SCOPES,
              redirect_uri: redirectUri,
              state,
              code_challenge: NodeCrypto.createHash("sha256").update(verifier).digest("base64url"),
              code_challenge_method: "S256",
            }).toString();
            return url.toString();
          }),
        ),
      complete: (state, code) =>
        Effect.gen(function* () {
          const flow = pending.get(state);
          if (!flow)
            return yield* fail("Slack sign-in expired or was already used. Connect again.");
          return yield* lock(flow.projectId)(
            Effect.gen(function* () {
              if (pending.get(state) !== flow || flow.expiresAt <= clock.currentTimeMillisUnsafe())
                return yield* fail("Slack sign-in expired or was already used. Connect again.");
              pending.delete(state);
              const result = yield* exchange({
                client_id: flow.clientId,
                redirect_uri: flow.redirectUri,
                code,
                grant_type: "authorization_code",
                code_verifier: flow.verifier,
              });
              if (!result.authed_user || !result.team)
                return yield* fail(
                  "Slack did not grant a user connection. Authorize the requested user permissions.",
                );
              const user = result.authed_user;
              const account = `${result.team.name} · ${user.id}`;
              yield* save(flow.projectId, {
                clientId: flow.clientId,
                accessToken: user.access_token,
                ...(user.refresh_token ? { refreshToken: user.refresh_token } : {}),
                expiresAt: user.expires_in
                  ? clock.currentTimeMillisUnsafe() + user.expires_in * 1000
                  : null,
                account,
              });
              return { projectId: flow.projectId, account };
            }),
          );
        }),
      cancel: (projectId) => lock(projectId)(cancel(projectId)),
      disconnect: (projectId) =>
        lock(projectId)(
          cancel(projectId).pipe(
            Effect.andThen(
              secrets
                .remove(credentialKey(projectId))
                .pipe(Effect.mapError(() => fail("Could not remove the Slack connection."))),
            ),
          ),
        ),
      accessToken: (projectId) =>
        lock(projectId)(
          Effect.gen(function* () {
            const stored = yield* secrets
              .get(credentialKey(projectId))
              .pipe(Effect.mapError(() => fail("Could not read the Slack connection.")));
            if (Option.isNone(stored))
              return yield* fail("Connect Slack in this project's Integrations settings.");
            const text = new TextDecoder().decode(stored.value);
            // Preserve manually configured connections while OAuth becomes the normal setup path.
            if (text.startsWith("xoxp-")) return text;
            let credential = yield* Effect.try({
              try: () => decodeCredential(text),
              catch: () => fail("Reconnect Slack to repair its saved connection."),
            });
            if (
              credential.expiresAt !== null &&
              credential.expiresAt <= clock.currentTimeMillisUnsafe() + 60_000
            ) {
              if (!credential.refreshToken)
                return yield* fail("Slack authorization expired. Reconnect Slack.");
              const result = yield* exchange({
                client_id: credential.clientId,
                grant_type: "refresh_token",
                refresh_token: credential.refreshToken,
              });
              const tokens = result.authed_user ?? result;
              if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in)
                return yield* fail("Slack authorization expired. Reconnect Slack.");
              credential = {
                ...credential,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt: clock.currentTimeMillisUnsafe() + tokens.expires_in * 1000,
              };
              yield* save(projectId, credential);
            }
            return credential.accessToken;
          }),
        ),
    });
  }),
);
