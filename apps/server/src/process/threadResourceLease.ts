import { ThreadCleanupError, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

const closing = new Set<string>();
const locks = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>();

export const isThreadClosing = (threadId: string) => closing.has(threadId);
export const beginThreadCleanup = (threadId: string) => closing.add(threadId);
export const finishThreadCleanup = (threadId: string) => closing.delete(threadId);

/** Launches share permits; cleanup takes all permits to drain in-flight launches. */
export const withThreadResourceLease = <A, E, R>(
  threadId: string,
  effect: Effect.Effect<A, E, R>,
  cleanup = false,
) =>
  Effect.suspend(() => {
    if (!cleanup && closing.has(threadId))
      return Effect.fail(
        new ThreadCleanupError({
          threadId: ThreadId.make(threadId),
          detail: "This chat is being resolved. Finish cleanup before starting more work.",
        }),
      );
    const lock = locks.get(threadId) ?? {
      semaphore: Semaphore.makeUnsafe(Number.MAX_SAFE_INTEGER),
      users: 0,
    };
    locks.set(threadId, lock);
    lock.users++;
    return lock.semaphore
      .withPermits(cleanup ? Number.MAX_SAFE_INTEGER : 1)(
        Effect.suspend<A, E | ThreadCleanupError, R>(() =>
          !cleanup && closing.has(threadId)
            ? Effect.fail(
                new ThreadCleanupError({
                  threadId: ThreadId.make(threadId),
                  detail: "This chat is being resolved. Finish cleanup before starting more work.",
                }),
              )
            : effect,
        ),
      )
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            lock.users--;
            if (lock.users === 0) locks.delete(threadId);
          }),
        ),
      );
  });
