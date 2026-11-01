import { type EnvironmentId, type ProjectId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createInboxEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  options: { refreshTrigger?: (environmentId: EnvironmentId) => Atom.Atom<unknown> } = {},
) {
  const acceptedReplies = Atom.family((_key: string) => Atom.make(0).pipe(Atom.keepAlive));
  const projectKey = (environmentId: EnvironmentId, projectId: ProjectId) =>
    JSON.stringify([environmentId, projectId]);
  const changes = Atom.family((key: string) =>
    Atom.make((get) => {
      const [environmentId] = JSON.parse(key) as [EnvironmentId, ProjectId];
      const external = options.refreshTrigger?.(environmentId);
      return [get(acceptedReplies(key)), external ? get(external) : undefined];
    }),
  );
  const refreshTrigger = ({
    environmentId,
    input,
  }: {
    environmentId: EnvironmentId;
    input: { projectId: ProjectId };
  }) => changes(projectKey(environmentId, input.projectId));
  return {
    linearRequest: createEnvironmentRpcCommand(runtime, {
      label: "linear:request",
      tag: WS_METHODS.linearRequest,
    }),
    linearBegin: createEnvironmentRpcCommand(runtime, {
      label: "linear:begin",
      tag: WS_METHODS.linearBegin,
    }),
    linearCancel: createEnvironmentRpcCommand(runtime, {
      label: "linear:cancel",
      tag: WS_METHODS.linearCancel,
    }),
    linearDisconnect: createEnvironmentRpcCommand(runtime, {
      label: "linear:disconnect",
      tag: WS_METHODS.linearDisconnect,
    }),
    linearPrepareMigration: createEnvironmentRpcCommand(runtime, {
      label: "linear:prepareMigration",
      tag: WS_METHODS.linearPrepareMigration,
    }),
    linearImportMigration: createEnvironmentRpcCommand(runtime, {
      label: "linear:importMigration",
      tag: WS_METHODS.linearImportMigration,
    }),

    beginSlack: createEnvironmentRpcCommand(runtime, {
      label: "inbox:beginSlack",
      tag: WS_METHODS.inboxBeginSlack,
    }),
    cancelSlack: createEnvironmentRpcCommand(runtime, {
      label: "inbox:cancelSlack",
      tag: WS_METHODS.inboxCancelSlack,
    }),
    beginSuperhuman: createEnvironmentRpcCommand(runtime, {
      label: "inbox:beginSuperhuman",
      tag: WS_METHODS.inboxBeginSuperhuman,
    }),
    superhumanCatalog: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "inbox:superhumanCatalog",
      tag: WS_METHODS.inboxSuperhumanCatalog,
      staleTimeMs: 30_000,
    }),
    sources: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "inbox:sources",
      tag: WS_METHODS.inboxSources,
      staleTimeMs: 5_000,
    }),
    configureSource: createEnvironmentRpcCommand(runtime, {
      label: "inbox:configureSource",
      tag: WS_METHODS.inboxConfigureSource,
    }),
    disconnectSource: createEnvironmentRpcCommand(runtime, {
      label: "inbox:disconnectSource",
      tag: WS_METHODS.inboxDisconnectSource,
    }),
    refreshSource: createEnvironmentRpcCommand(runtime, {
      label: "inbox:refreshSource",
      tag: WS_METHODS.inboxRefreshSource,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      refreshTrigger,
      label: "inbox:list",
      tag: WS_METHODS.inboxList,
      staleTimeMs: 5_000,
    }),
    get: createEnvironmentRpcQueryAtomFamily(runtime, {
      refreshTrigger,
      label: "inbox:get",
      tag: WS_METHODS.inboxGet,
      staleTimeMs: 5_000,
    }),
    linearAgentThread: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "inbox:linearAgentThread",
      tag: WS_METHODS.inboxLinearAgentThread,
      staleTimeMs: 5_000,
    }),
    loadPreviousComments: createEnvironmentRpcCommand(runtime, {
      label: "inbox:loadPreviousComments",
      tag: WS_METHODS.inboxGet,
    }),
    reply: createEnvironmentRpcCommand(runtime, {
      label: "inbox:reply",
      tag: WS_METHODS.inboxReply,
      onSuccess: ({ environmentId, input }, registry, result) =>
        Effect.sync(() => {
          if (result.status === "sent") {
            registry.update(
              acceptedReplies(projectKey(environmentId, input.projectId)),
              (n) => n + 1,
            );
          }
        }),
    }),
    mutate: createEnvironmentRpcCommand(runtime, {
      label: "inbox:mutate",
      tag: WS_METHODS.inboxMutate,
    }),
  };
}
