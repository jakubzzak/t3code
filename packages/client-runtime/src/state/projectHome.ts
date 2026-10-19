import { ProjectHomeSnapshot, ProjectLibraryListResult, WS_METHODS } from "@t3tools/contracts";
import { persistQuery } from "./queryPersistence.ts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createProjectHomeEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    open: createEnvironmentRpcCommand(runtime, {
      label: "project-home:open",
      tag: WS_METHODS.projectHomeOpen,
    }),
    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "project-home:snapshot",
      tag: WS_METHODS.projectHomeSnapshot,
      staleTimeMs: 1000,
      persistence: persistQuery(ProjectHomeSnapshot),
    }),
    customize: createEnvironmentRpcCommand(runtime, {
      label: "project-home:customize",
      tag: WS_METHODS.projectHomeCustomize,
    }),
    visit: createEnvironmentRpcCommand(runtime, {
      label: "project-home:visit",
      tag: WS_METHODS.projectHomeVisit,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "project-home:list",
      tag: WS_METHODS.projectLibraryList,
      staleTimeMs: 1000,
      persistence: persistQuery(ProjectLibraryListResult),
    }),
    read: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "project-home:read",
      tag: WS_METHODS.projectLibraryRead,
      staleTimeMs: 1000,
    }),
    saveLink: createEnvironmentRpcCommand(runtime, {
      label: "project-home:saveLink",
      tag: WS_METHODS.projectLibrarySaveLink,
    }),
    retry: createEnvironmentRpcCommand(runtime, {
      label: "project-home:retry",
      tag: WS_METHODS.projectLibraryRetry,
    }),
    attach: createEnvironmentRpcCommand(runtime, {
      label: "project-home:attach",
      tag: WS_METHODS.projectLibraryAttach,
    }),
  };
}
