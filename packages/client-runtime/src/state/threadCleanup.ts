import type { ScopedThreadRef } from "@t3tools/contracts";

export interface CleanupRequest {
  readonly target: ScopedThreadRef;
  readonly interruptAgent: boolean;
  readonly done: (resolved?: boolean) => void;
}

const pending = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();
let queue: readonly CleanupRequest[] = [];

export const getCleanupRequest = () => queue[0] ?? null;
export const subscribeCleanupRequests = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Survives navigation; false means confirmation was canceled before cleanup started. */
export function requestThreadCleanup(target: ScopedThreadRef, interruptAgent: boolean) {
  const key = JSON.stringify([target.environmentId, target.threadId]);
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = new Promise<boolean>((resolve) => {
    const request: CleanupRequest = {
      target,
      interruptAgent,
      done: (resolved = true) => {
        pending.delete(key);
        queue = queue.filter((entry) => entry !== request);
        for (const listener of listeners) listener();
        resolve(resolved);
      },
    };
    queue = [...queue, request];
    for (const listener of listeners) listener();
  });
  pending.set(key, promise);
  return promise;
}
