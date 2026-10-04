import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import {
  beginThreadCleanup,
  finishThreadCleanup,
  withThreadResourceLease,
} from "./threadResourceLease.ts";

it.effect("allows concurrent work but drains both launches before cleanup", () =>
  Effect.gen(function* () {
    const threadId = "lease-concurrency-test";
    const firstStarted = yield* Deferred.make<void>();
    const secondStarted = yield* Deferred.make<void>();
    const firstRelease = yield* Deferred.make<void>();
    const secondRelease = yield* Deferred.make<void>();
    const first = yield* withThreadResourceLease(
      threadId,
      Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(firstRelease))),
    ).pipe(Effect.forkChild);
    const second = yield* withThreadResourceLease(
      threadId,
      Deferred.succeed(secondStarted, undefined).pipe(
        Effect.andThen(Deferred.await(secondRelease)),
      ),
    ).pipe(Effect.forkChild);
    yield* Deferred.await(firstStarted);
    yield* Deferred.await(secondStarted);
    beginThreadCleanup(threadId);
    let cleaned = false;
    const cleanup = yield* withThreadResourceLease(
      threadId,
      Effect.sync(() => {
        cleaned = true;
      }),
      true,
    ).pipe(Effect.forkChild({ startImmediately: true }));
    expect(cleaned).toBe(false);
    const rejected = yield* withThreadResourceLease(threadId, Effect.die("must not launch")).pipe(
      Effect.flip,
    );
    expect(rejected._tag).toBe("ThreadCleanupError");
    yield* Deferred.succeed(firstRelease, undefined);
    yield* Fiber.join(first);
    expect(cleaned).toBe(false);
    yield* Deferred.succeed(secondRelease, undefined);
    yield* Fiber.join(second);
    yield* Fiber.join(cleanup);
    expect(cleaned).toBe(true);
  }).pipe(Effect.ensuring(Effect.sync(() => finishThreadCleanup("lease-concurrency-test")))),
);
