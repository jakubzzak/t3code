import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createInboxEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
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
      label: "inbox:list",
      tag: WS_METHODS.inboxList,
      staleTimeMs: 5_000,
    }),
    get: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "inbox:get",
      tag: WS_METHODS.inboxGet,
      staleTimeMs: 5_000,
    }),
    mutate: createEnvironmentRpcCommand(runtime, {
      label: "inbox:mutate",
      tag: WS_METHODS.inboxMutate,
    }),
  };
}
