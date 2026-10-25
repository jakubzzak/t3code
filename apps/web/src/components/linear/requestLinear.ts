import {
  EnvironmentId,
  ProjectId,
  type LinearDesktopRequest,
  type LinearDesktopResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { formatEnvironmentQueryError } from "~/state/query";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentServerConfigsAtom } from "~/state/server";
import { inboxEnvironment } from "~/state/inbox";
const decodeKey = Schema.decodeUnknownSync(Schema.Tuple([EnvironmentId, ProjectId]));
export function linearProjectKey(key: string) {
  const [environmentId, projectId] = decodeKey(JSON.parse(key));
  return { environmentId, projectId };
}
/** Updated environments are authoritative; older environments retain the desktop compatibility path. */
export async function requestLinear(input: LinearDesktopRequest): Promise<LinearDesktopResult> {
  const { environmentId, projectId } = linearProjectKey(input.connectionKey);
  if (!appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.notificationInbox) {
    if (!window.desktopBridge?.linearRequest)
      throw new Error("Update the environment to connect Linear.");
    return window.desktopBridge.linearRequest(input);
  }
  const operation = input.operation;
  if (
    operation !== "status" &&
    operation !== "issues" &&
    operation !== "issue" &&
    operation !== "teams" &&
    operation !== "states"
  )
    throw new Error("Manage the environment connection in Integrations.");
  const result = await runAtomCommand(
    appAtomRegistry,
    inboxEnvironment.linearRequest,
    { environmentId, input: { ...input, operation, projectId } },
    { reportFailure: false },
  );
  if (result._tag === "Success") return result.value;
  throw new Error(formatEnvironmentQueryError(result.cause));
}
