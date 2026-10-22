import { createInboxEnvironmentAtoms } from "@t3tools/client-runtime/state/inbox";
import { connectionAtomRuntime } from "../connection/runtime";
export const inboxEnvironment = createInboxEnvironmentAtoms(connectionAtomRuntime);
