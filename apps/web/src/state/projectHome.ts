import { createProjectHomeEnvironmentAtoms } from "@t3tools/client-runtime/state/projectHome";
import { connectionAtomRuntime } from "../connection/runtime";
export const projectHomeEnvironment = createProjectHomeEnvironmentAtoms(connectionAtomRuntime);
