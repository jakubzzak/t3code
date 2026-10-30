import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  SlackSendResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpBody, HttpClient, HttpClientResponse, HttpRouter } from "effect/http";
import * as Config from "../../../config.ts";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as Secrets from "../../../auth/ServerSecretStore.ts";
import * as Vault from "../../../auth/IntegrationVaultKey.ts";
import * as Connection from "../../../inbox/SlackConnection.ts";
import * as Slack from "../../../inbox/SlackService.ts";
import * as Sqlite from "../../../persistence/Sqlite.ts";
import * as Settings from "../../../serverSettings.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as Registry from "../../McpSessionRegistry.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as Handlers from "./handlers.ts";
import { SlackToolkit } from "./tools.ts";

const projectId = ProjectId.make("slack-http-project");
const threadId = ThreadId.make("slack-http-agent");
const decodeRpc = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ result: Schema.Unknown })),
);
const decodeTool = Schema.decodeUnknownSync(
  Schema.Struct({
    isError: Schema.optionalKey(Schema.Boolean),
    structuredContent: Schema.optionalKey(Schema.Unknown),
    content: Schema.Array(
      Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
    ),
  }),
);
const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeSend = Schema.decodeUnknownSync(SlackSendResult);
const decodeCatalog = Schema.decodeUnknownSync(
  Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
);
const Posted = Schema.Struct({
  channel: Schema.String,
  text: Schema.String,
  thread_ts: Schema.optionalKey(Schema.String),
});
const decodePost = Schema.decodeSync(Schema.fromJsonString(Posted));

it.effect(
  "uses stored user credentials through authenticated MCP, preserves reviewed text, replays receipts and denies restricted or inactive agents",
  () => {
    const posts: (typeof Posted.Type)[] = [];
    const backend = HttpClient.make((request) =>
      Effect.sync(() => {
        expect(request.headers.authorization).toBe("Bearer fixture-slack-user-token");
        const method = new URL(request.url).pathname.split("/").at(-1);
        let result: unknown;
        switch (method) {
          case "auth.test":
            result = { ok: true, team_id: "T1", user_id: "U1" };
            break;
          case "conversations.open":
            result = { ok: true, channel: { id: "D1" } };
            break;
          case "chat.postMessage": {
            expect(request.body._tag).toBe("Uint8Array");
            if (request.body._tag !== "Uint8Array") throw new Error("Expected Slack JSON body");
            const body = decodePost(new TextDecoder().decode(request.body.body));
            posts.push(body);
            result = { ok: true, channel: body.channel, ts: "1793260900.000001" };
            break;
          }
          case "conversations.history":
            result = {
              ok: true,
              messages: posts.map((post) => ({
                ts: "1793260900.000001",
                user: "U1",
                text: post.text,
              })),
            };
            break;
          default:
            throw new Error("Unexpected Slack API call");
        }
        return HttpClientResponse.fromWeb(
          request,
          Response.json(result, { headers: { "x-oauth-scopes": "chat:write,im:write" } }),
        );
      }),
    );
    const encryptedSecrets = Layer.effect(Secrets.ServerSecretStore, Secrets.make).pipe(
      Layer.provide(
        Layer.succeed(Vault.IntegrationVaultKey, {
          get: Effect.succeed(new Uint8Array(32).fill(7)),
        }),
      ),
    );
    const connection = Connection.layer.pipe(
      Layer.provideMerge(encryptedSecrets),
      Layer.provide(Settings.layerTest({})),
      Layer.provide(Layer.succeed(HttpClient.HttpClient, backend)),
    );
    const services = Slack.layer.pipe(
      Layer.provideMerge(connection),
      Layer.provideMerge(Sqlite.layerMemory),
      Layer.provide(Layer.succeed(HttpClient.HttpClient, backend)),
    );

    return Effect.scoped(
      Effect.gen(function* () {
        const secrets = yield* Secrets.ServerSecretStore;
        yield* secrets.set(
          `inbox-slack-${projectId}`,
          new TextEncoder().encode(
            JSON.stringify({
              clientId: "fixture-client",
              accessToken: "fixture-slack-user-token",
              expiresAt: null,
              account: "Fixture · U1",
              scopes: ["chat:write", "im:write"],
            }),
          ),
        );
        const caller = yield* Ref.make(liveThreadShell(threadId));
        const routes = Layer.mergeAll(
          McpHttpServer.toolkitRegistration(SlackToolkit, Handlers.layer),
          McpHttpServer.layerMcpTransport,
        ).pipe(Layer.provide(Registry.layer));
        yield* HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(
          Layer.provide(
            Layer.mock(Environment.ServerEnvironment)({
              getEnvironmentId: Effect.succeed(EnvironmentId.make("slack-http-environment")),
            }),
          ),
          Layer.provide(
            Layer.mock(Threads.ThreadManagementService)({ getThreadShell: () => Ref.get(caller) }),
          ),
          Layer.build,
        );
        const credential = yield* Registry.issueActiveMcpCredential({
          threadId,
          providerInstanceId: ProviderInstanceId.make("codex"),
        });
        expect(credential).toBeDefined();
        if (!credential) return;
        const http = yield* HttpClient.HttpClient;
        let sessionId: string | undefined;
        let sequence = 0;
        const rpc = Effect.fnUntraced(function* (method: string, params: unknown) {
          const response = yield* http.post("/mcp", {
            headers: {
              accept: "application/json, text/event-stream",
              authorization: credential.config.authorizationHeader,
              "mcp-protocol-version": "2025-06-18",
              ...(sessionId ? { "mcp-session-id": sessionId } : {}),
            },
            body: HttpBody.text(
              JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }),
              "application/json",
            ),
          });
          expect(response.status).toBe(200);
          sessionId = response.headers["mcp-session-id"] ?? sessionId;
          const body = yield* response.text;
          return decodeRpc(body.match(/\{.*\}/s)![0]).result;
        });
        const call = Effect.fnUntraced(function* (name: string, args: unknown) {
          const result = decodeTool(yield* rpc("tools/call", { name, arguments: args }));
          const text = result.content.find((item) => item.type === "text")?.text;
          return {
            isError: result.isError ?? false,
            data: result.structuredContent ?? (text ? decodeJson(text) : null),
          };
        });
        yield* rpc("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "slack-test", version: "1" },
        });
        const catalog = decodeCatalog(yield* rpc("tools/list", {}));
        expect(catalog.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["slack_read", "slack_send"]),
        );
        expect(
          (yield* call("slack_read", { projectId, method: "auth.test", parameters: {} })).data,
        ).toMatchObject({ ok: true, team_id: "T1", user_id: "U1" });
        const input = {
          projectId,
          commandId: CommandId.make("reviewed-dm"),
          connectionId: "T1:U1",
          destination: { userIds: ["U2"] },
          text: "\n  reviewed indentation  \n",
        };
        const sent = yield* call("slack_send", input);
        expect(sent.isError).toBe(false);
        const receipt = decodeSend(sent.data);
        expect(receipt).toMatchObject({ status: "sent", channelId: "D1", ts: "1793260900.000001" });
        expect(posts).toEqual([{ channel: "D1", text: input.text }]);
        expect(
          (yield* call("slack_read", {
            projectId,
            method: "conversations.history",
            parameters: { channel: "D1" },
          })).data,
        ).toMatchObject({ messages: [{ user: "U1", text: input.text }] });
        expect((yield* call("slack_send", input)).data).toEqual(receipt);
        expect(posts).toHaveLength(1);
        yield* Ref.set(caller, liveThreadShell(threadId, { runtimeMode: "approval-required" }));
        expect(
          yield* call("slack_send", { ...input, commandId: CommandId.make("denied-restricted") }),
        ).toMatchObject({ isError: true, data: { code: "capability_denied" } });
        yield* Ref.set(caller, liveThreadShell(threadId, { interactionMode: "plan" }));
        expect(
          yield* call("slack_send", { ...input, commandId: CommandId.make("denied-plan") }),
        ).toMatchObject({ isError: true, data: { code: "capability_denied" } });
        yield* Ref.set(caller, liveThreadShell(threadId, { activeRunId: null }));
        expect(
          yield* call("slack_send", { ...input, commandId: CommandId.make("denied-inactive") }),
        ).toMatchObject({ isError: true, data: { code: "parent_not_active" } });
        expect(posts).toHaveLength(1);
        expect(JSON.stringify(sent)).not.toContain("fixture-slack-user-token");
        expect(Option.isSome(yield* secrets.get(`inbox-slack-${projectId}`))).toBe(true);
      }),
    ).pipe(
      Effect.provide(
        services.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              NodeHttpServer.layerTest,
              Config.layerTest(process.cwd(), { prefix: "t3-slack-http-" }).pipe(
                Layer.provide(NodeServices.layer),
              ),
              NodeServices.layer,
            ),
          ),
        ),
      ),
    );
  },
);
