import type { ScopedThreadRef } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readThreadShell } from "~/state/entities";
import { environmentServerConfigsAtom } from "~/state/server";

/** Resolve at execution time so a destination project never inherits a device opt-in. */
export function readLinearViewEnabled(ref: ScopedThreadRef): boolean {
  const thread = readThreadShell(ref);
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(ref.environmentId);
  return (
    !!thread &&
    !!config &&
    resolveProjectSettings(config.settings, thread.projectId).settings.linearViewEnabled
  );
}
