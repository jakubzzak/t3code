import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { readImageDimensions } from "@t3tools/shared/imageDimensions";
import * as ServerConfig from "../config.ts";
import { resolveAttachmentPathById } from "../attachmentStore.ts";
import { isSlackFileUrl } from "./slackFiles.ts";
import { SlackFile, messageImages } from "./connectors/slackMessages.ts";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { InboxReplyError, type InboxReplyInput, type InboxReplyMessage } from "@t3tools/contracts";
import * as Slack from "./SlackConnection.ts";
import * as Linear from "../linear/LinearConnection.ts";

export class InboxReplyTransport extends Context.Service<
  InboxReplyTransport,
  {
    readonly send: (
      input: InboxReplyInput,
      connectionId: string,
    ) => Effect.Effect<InboxReplyMessage, InboxReplyError>;
  }
>()("t3/inbox/InboxReplyTransport") {}

const Identity = Schema.Struct({
  ok: Schema.Boolean,
  team_id: Schema.String,
  user_id: Schema.String,
});
const Posted = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
  ts: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.Struct({ text: Schema.optionalKey(Schema.String) })),
});
const Uploaded = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
  upload_url: Schema.optionalKey(Schema.String),
  file_id: Schema.optionalKey(Schema.String),
});
const FileShares = Schema.Struct({
  file: Schema.Struct({
    ...SlackFile.fields,
    shares: Schema.optionalKey(
      Schema.Struct({
        public: Schema.optionalKey(
          Schema.Record(
            Schema.String,
            Schema.Array(
              Schema.Struct({ ts: Schema.String, thread_ts: Schema.optionalKey(Schema.String) }),
            ),
          ),
        ),
        private: Schema.optionalKey(
          Schema.Record(
            Schema.String,
            Schema.Array(
              Schema.Struct({ ts: Schema.String, thread_ts: Schema.optionalKey(Schema.String) }),
            ),
          ),
        ),
      }),
    ),
  }),
});

const make = Effect.gen(function* () {
  const slack = yield* Slack.SlackConnection;
  const linear = yield* Linear.LinearConnection;
  const http = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  return InboxReplyTransport.of({
    send: (input, connectionId) =>
      Effect.gen(function* () {
        if (input.target.source === "linear") {
          if (input.images?.length) return yield* new InboxReplyError({ reason: "rejected" });
          return yield* linear.createComment(input.projectId, connectionId, {
            ...input.target,
            body: input.text,
          });
        }
        const token = yield* slack
          .accessToken(input.projectId)
          .pipe(Effect.mapError(() => new InboxReplyError({ reason: "permission" })));
        // Verify the grant and account before posting, including manually entered legacy tokens.
        const identityResponse = yield* http
          .execute(
            HttpClientRequest.get("https://slack.com/api/auth.test").pipe(
              HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
            ),
          )
          .pipe(Effect.mapError(() => new InboxReplyError({ reason: "permission" })));
        if (identityResponse.status === 429)
          return yield* new InboxReplyError({
            reason: "rate-limit",
            retryAfter: Number(identityResponse.headers["retry-after"]) || 60,
          });
        const identity = yield* identityResponse.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Identity)),
          Effect.mapError(() => new InboxReplyError({ reason: "permission" })),
        );
        if (
          !identity.ok ||
          `${identity.team_id}:${identity.user_id}` !== connectionId ||
          !(identityResponse.headers["x-oauth-scopes"] ?? "")
            .split(",")
            .map((scope) => scope.trim())
            .includes("chat:write")
        )
          return yield* new InboxReplyError({ reason: "permission" });
        if (input.images?.length) {
          if (
            !(identityResponse.headers["x-oauth-scopes"] ?? "")
              .split(",")
              .map((value) => value.trim())
              .includes("files:write")
          )
            return yield* new InboxReplyError({ reason: "permission" });
          const call = (method: string, body: unknown, final = false) =>
            Effect.gen(function* () {
              const response = yield* http
                .execute(
                  HttpClientRequest.post(`https://slack.com/api/${method}`).pipe(
                    HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
                    HttpClientRequest.bodyJsonUnsafe(body),
                  ),
                )
                .pipe(
                  Effect.mapError(
                    () => new InboxReplyError({ reason: final ? "uncertain" : "rejected" }),
                  ),
                );
              if (response.status === 429)
                return yield* new InboxReplyError({ reason: "rate-limit" });
              if (response.status !== 200)
                return yield* new InboxReplyError({ reason: final ? "uncertain" : "rejected" });
              const result = yield* response.json.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Uploaded)),
                Effect.mapError(
                  () => new InboxReplyError({ reason: final ? "uncertain" : "rejected" }),
                ),
              );
              if (!result.ok)
                return yield* new InboxReplyError({
                  reason: [
                    "missing_scope",
                    "invalid_auth",
                    "token_revoked",
                    "token_expired",
                  ].includes(result.error ?? "")
                    ? "permission"
                    : ["ratelimited", "rate_limited"].includes(result.error ?? "")
                      ? "rate-limit"
                      : final &&
                          ["fatal_error", "internal_error", "service_unavailable"].includes(
                            result.error ?? "",
                          )
                        ? "uncertain"
                        : "rejected",
                });
              return result;
            });
          const files: { id: string; title: string }[] = [];
          for (const image of input.images) {
            const path = resolveAttachmentPathById({
              attachmentsDir: config.attachmentsDir,
              attachmentId: image.attachmentId,
            });
            if (!path) return yield* new InboxReplyError({ reason: "rejected" });
            const info = yield* fs
              .stat(path)
              .pipe(Effect.mapError(() => new InboxReplyError({ reason: "rejected" })));
            if (info.size !== BigInt(image.sizeBytes) || info.size > BigInt(10 * 1024 * 1024))
              return yield* new InboxReplyError({ reason: "rejected" });
            const bytes = yield* fs
              .readFile(path)
              .pipe(Effect.mapError(() => new InboxReplyError({ reason: "rejected" })));
            if (bytes.length !== image.sizeBytes || !readImageDimensions(bytes))
              return yield* new InboxReplyError({ reason: "rejected" });
            const ticket = yield* call("files.getUploadURLExternal", {
              filename: image.name,
              length: bytes.length,
            });
            if (!ticket.file_id || !ticket.upload_url || !isSlackFileUrl(ticket.upload_url))
              return yield* new InboxReplyError({ reason: "rejected" });
            const upload = yield* http
              .execute(
                HttpClientRequest.post(ticket.upload_url).pipe(
                  HttpClientRequest.bodyUint8Array(bytes, image.mimeType),
                ),
              )
              .pipe(
                Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
                Effect.mapError(() => new InboxReplyError({ reason: "rejected" })),
              );
            if (upload.status !== 200) return yield* new InboxReplyError({ reason: "rejected" });
            files.push({ id: ticket.file_id, title: image.name });
          }
          // Sharing is the only externally visible step. A lost completion response must never
          // cause a retry to post the images (or their caption) a second time.
          const sharedAt = yield* Clock.currentTimeMillis;
          yield* call(
            "files.completeUploadExternal",
            {
              files,
              channel_id: input.target.channelId,
              thread_ts: input.target.threadTs,
              ...(input.text.trim() ? { initial_comment: input.text } : {}),
            },
            true,
          );
          // Completion confirms delivery but does not return a message timestamp. Resolve the
          // native share when available so subsequent intake uses Slack's ordering, not our clock.
          const metadata = yield* Effect.forEach(files, (file) =>
            http
              .execute(
                HttpClientRequest.get("https://slack.com/api/files.info").pipe(
                  HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
                  HttpClientRequest.setUrlParam("file", file.id),
                ),
              )
              .pipe(
                Effect.flatMap((response) => response.json),
                Effect.flatMap(Schema.decodeUnknownEffect(FileShares)),
                Effect.timeout("5 seconds"),
                Effect.orElseSucceed(() => null),
              ),
          );
          const shares = metadata[0];
          const channel = input.target.channelId;
          const threadTs = input.target.threadTs;
          const ts = [
            ...(shares?.file.shares?.public?.[channel] ?? []),
            ...(shares?.file.shares?.private?.[channel] ?? []),
          ].find((share) => share.thread_ts === threadTs && /^\d+\.\d+$/.test(share.ts))?.ts;
          const images = messageImages({
            ts: ts ?? "",
            files: metadata.flatMap((entry) => (entry ? [entry.file] : [])),
          });
          return {
            id: ts ?? `file:${files[0]!.id}`,
            images: files.map(
              (file) =>
                images.find((image) => image.id === file.id) ?? { id: file.id, name: file.title },
            ),
            author: identity.user_id,
            text: input.text,
            occurredAt: DateTime.formatIso(DateTime.makeUnsafe(ts ? Number(ts) * 1000 : sharedAt)),
          };
        }
        const response = yield* http
          .execute(
            HttpClientRequest.post("https://slack.com/api/chat.postMessage").pipe(
              HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
              HttpClientRequest.bodyJsonUnsafe({
                channel: input.target.channelId,
                thread_ts: input.target.threadTs,
                text: input.text,
                reply_broadcast: false,
                unfurl_links: false,
                unfurl_media: false,
              }),
            ),
          )
          .pipe(Effect.mapError(() => new InboxReplyError({ reason: "uncertain" })));
        if (response.status === 429)
          return yield* new InboxReplyError({
            reason: "rate-limit",
            retryAfter: Number(response.headers["retry-after"]) || 60,
          });
        if (response.status === 401 || response.status === 403)
          return yield* new InboxReplyError({ reason: "permission" });
        if (response.status !== 200)
          return yield* new InboxReplyError({
            reason: response.status >= 500 ? "uncertain" : "rejected",
          });
        const result = yield* response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Posted)),
          Effect.mapError(() => new InboxReplyError({ reason: "uncertain" })),
        );
        if (!result.ok) {
          const reason = [
            "missing_scope",
            "invalid_auth",
            "token_revoked",
            "token_expired",
            "not_authed",
          ].includes(result.error ?? "")
            ? "permission"
            : ["ratelimited", "rate_limited"].includes(result.error ?? "")
              ? "rate-limit"
              : ["fatal_error", "internal_error", "service_unavailable"].includes(
                    result.error ?? "",
                  )
                ? "uncertain"
                : "rejected";
          return yield* new InboxReplyError({ reason });
        }
        if (!result.ts || !/^\d+\.\d+$/.test(result.ts))
          return yield* new InboxReplyError({ reason: "uncertain" });
        return {
          id: result.ts,
          author: identity.user_id,
          text: result.message?.text ?? input.text,
          occurredAt: DateTime.formatIso(DateTime.makeUnsafe(Number(result.ts) * 1000)),
        };
      }).pipe(
        Effect.timeoutOrElse({
          duration: input.images?.length ? "3 minutes" : "45 seconds",
          orElse: () => new InboxReplyError({ reason: "uncertain" }),
        }),
      ),
  });
});
export const layer = Layer.effect(InboxReplyTransport, make);
