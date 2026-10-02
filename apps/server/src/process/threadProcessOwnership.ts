import * as NodeCrypto from "node:crypto";

/** Stable across server restarts, isolated by the environment's data directory. */
export const threadProcessOwner = (threadId: string, stateDir: string) =>
  `${NodeCrypto.createHash("sha256").update(stateDir).digest("hex")}:${threadId}`;

/** Inherited by provider tool commands, including detached background jobs. */
export function withThreadProcessOwner(env: NodeJS.ProcessEnv, threadId: string, stateDir: string) {
  return { ...env, T3CODE_PROCESS_OWNER: threadProcessOwner(threadId, stateDir) };
}
