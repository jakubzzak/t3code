import { LinearConnection } from "../linear/LinearConnection.ts";
import { HttpServerRequest } from "effect/http";
import { requestUrls } from "../auth/McpOAuth.ts";
import { WsInboxRpcGroup, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { RpcInstrumentation } from "../observability/RpcInstrumentation.ts";
import { InboxService } from "./InboxService.ts";
import { InboxSources } from "./InboxSources.ts";
const group = WsInboxRpcGroup.middleware(RpcInstrumentation);
export const layer = group.toLayer(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const origin = requestUrls(request).issuer;
    const inbox = yield* InboxService;
    const sources = yield* InboxSources;
    const linear = yield* LinearConnection;
    return group.of({
      [WS_METHODS.linearRequest]: (input) => linear.request(input.projectId, input),
      [WS_METHODS.linearBegin]: (input) => linear.begin(input.projectId, origin),
      [WS_METHODS.linearCancel]: (input) => linear.cancel(input.projectId),
      [WS_METHODS.linearDisconnect]: (input) => linear.disconnect(input.projectId),
      [WS_METHODS.linearPrepareMigration]: (input) => linear.prepareMigration(input.projectId),
      [WS_METHODS.linearImportMigration]: (input) =>
        linear.importMigration(input.projectId, input.ticket, input.envelope),
      [WS_METHODS.inboxBeginSlack]: (input) => sources.beginSlack(input.projectId, origin),
      [WS_METHODS.inboxCancelSlack]: (input) => sources.cancelSlack(input.projectId),
      [WS_METHODS.inboxBeginSuperhuman]: (input) =>
        sources.beginSuperhuman(input.projectId, origin),
      [WS_METHODS.inboxSuperhumanCatalog]: (input) => sources.superhumanCatalog(input.projectId),
      [WS_METHODS.inboxList]: (input) => inbox.list(input),
      [WS_METHODS.inboxGet]: (input) => sources.get(input),
      [WS_METHODS.inboxLinearAgentThread]: (input) => sources.linearAgentThread(input),
      [WS_METHODS.inboxReply]: (input) => inbox.reply<never, never>(input),
      [WS_METHODS.inboxMutate]: (input) => inbox.mutate<never, never>(input),
      [WS_METHODS.inboxSources]: (input) => sources.list(input.projectId),
      [WS_METHODS.inboxConfigureSource]: (input) => sources.configure(input),
      [WS_METHODS.inboxDisconnectSource]: (input) => sources.disconnect(input),
      [WS_METHODS.inboxRefreshSource]: (input) => sources.refresh(input),
    });
  }),
);
