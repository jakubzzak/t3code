import { createInboxEnvironmentAtoms } from "@t3tools/client-runtime/state/inbox";
import { connectionAtomRuntime } from "../connection/runtime";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";
export const inboxEnvironment = createInboxEnvironmentAtoms(connectionAtomRuntime);

/** Read full notification detail for a composer handoff, without fetching source history. */
export function readInboxNotification(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  id: string,
) {
  return Effect.runPromise(
    AtomRegistry.getResult(
      appAtomRegistry,
      inboxEnvironment.get({ environmentId, input: { projectId, id } }),
      { suspendOnWaiting: true },
    ).pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
}
