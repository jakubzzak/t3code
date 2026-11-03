import { describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { DesktopHotspot, layer } from "./DesktopHotspot.ts";
import { HotspotError, HotspotSystem } from "./HotspotSystem.ts";

vi.mock("electron", () => ({}));

const harness = Effect.gen(function* () {
  const firstCheck = yield* Deferred.make<void>();
  const joinStarted = yield* Deferred.make<void>();
  let online = false;
  let names: string[] = ["Failed Wi-Fi"];
  let currentName: string | null = "iPhone";
  let authorization: Effect.Effect<void, HotspotError> = Effect.void;
  let scanError: HotspotError | null = null;
  let replacementDuringScan: string | null = null;
  const failedNames = new Set<string>();
  const expectedSources: string[] = [];
  let join: Effect.Effect<string, HotspotError> = Effect.succeed("iPhone");
  let checks = 0;
  let joins = 0;
  let authorizations = 0;
  let scanRecovers = false;
  const returned: string[] = [];
  const system = HotspotSystem.of({
    authorize: Effect.suspend(() => {
      authorizations++;
      return authorization;
    }),
    online: Effect.sync(() => {
      checks++;
      return online;
    }).pipe(Effect.tap(() => Deferred.succeed(firstCheck, undefined))),
    knownInRange: Effect.suspend(() => {
      if (scanRecovers) online = true;
      if (replacementDuringScan !== null) currentName = replacementDuringScan;
      return scanError === null ? Effect.succeed(names) : Effect.fail(scanError);
    }),
    currentName: Effect.sync(() => currentName),
    join: Effect.suspend(() => {
      joins++;
      return Deferred.succeed(joinStarted, undefined).pipe(Effect.andThen(join));
    }),
    joinKnown: (name, expectedSource) =>
      Effect.suspend(() => {
        returned.push(name);
        expectedSources.push(expectedSource);
        if (failedNames.has(name))
          return Effect.fail(new HotspotError({ message: "Could not return to known Wi-Fi." }));
        currentName = name;
        return Effect.void;
      }),
  });
  return {
    firstCheck,
    joinStarted,
    returned,
    expectedSources,
    failedNames,
    authorize: (effect: Effect.Effect<void, HotspotError>) => {
      authorization = effect;
    },
    failScan: (failed: boolean) => {
      scanError = failed ? new HotspotError({ message: "Scan unavailable" }) : null;
    },
    replaceDuringScan: (name: string) => {
      replacementDuringScan = name;
    },
    checks: () => checks,
    joins: () => joins,
    authorizations: () => authorizations,
    online: (value: boolean) => {
      online = value;
    },
    names: (value: string[]) => {
      names = value;
    },
    currentName: (value: string | null) => {
      currentName = value;
    },
    join: (effect: Effect.Effect<string, HotspotError>) => {
      join = effect;
    },
    recoverDuringScan: () => {
      scanRecovers = true;
    },
    provide: <A, E>(effect: Effect.Effect<A, E, DesktopHotspot>) =>
      effect.pipe(Effect.provide(layer.pipe(Layer.provide(Layer.succeed(HotspotSystem, system))))),
  };
});

describe("app-owned hotspot failover", () => {
  it.effect(
    "does no network work until enabled; ignores healthy internet and stops on disable",
    () =>
      Effect.gen(function* () {
        const h = yield* harness;
        h.online(true);
        yield* h.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const hotspot = yield* DesktopHotspot;
              yield* hotspot.initialize;
              yield* TestClock.adjust("10 seconds");
              expect(h.checks()).toBe(0);
              yield* hotspot.setActive(true);
              yield* Deferred.await(h.firstCheck);
              yield* TestClock.adjust("20 seconds");
              expect(h.joins()).toBe(0);
              yield* hotspot.setActive(true);
              expect(h.authorizations()).toBe(1);
              yield* hotspot.setActive(false);
              const count = h.checks();
              yield* TestClock.adjust("1 minute");
              expect(h.checks()).toBe(count);
              expect(yield* hotspot.message).toBeNull();
            }),
          ),
        );
      }),
  );

  it.effect("waits for sustained loss, retries with backoff, and recovers", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.join(Effect.fail(new HotspotError({ message: "iPhone unavailable" })));
      yield* h.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const hotspot = yield* DesktopHotspot;
            yield* hotspot.initialize;
            yield* hotspot.setActive(true);
            yield* Deferred.await(h.firstCheck);
            expect(h.joins()).toBe(0);
            yield* TestClock.adjust("5 seconds");
            expect(h.joins()).toBe(1);
            expect(yield* hotspot.message).toContain("unavailable");
            yield* TestClock.adjust("5 seconds");
            expect(h.joins()).toBe(2);
            yield* TestClock.adjust("5 seconds");
            expect(h.joins()).toBe(2);
            h.join(Effect.succeed("iPhone"));
            yield* TestClock.adjust("5 seconds");
            expect(h.joins()).toBe(3);
            expect(yield* hotspot.message).toContain("Connected");
            h.online(true);
            yield* TestClock.adjust("20 seconds");
            expect(h.joins()).toBe(3);
          }),
        ),
      );
    }),
  );

  it.effect("cancels an in-flight native attempt on disable and on app scope close", () =>
    Effect.gen(function* () {
      for (const disable of [true, false]) {
        const h = yield* harness;
        let interrupted = false;
        h.join(
          Effect.never.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                interrupted = true;
              }),
            ),
          ),
        );
        yield* h.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const hotspot = yield* DesktopHotspot;
              yield* hotspot.initialize;
              yield* hotspot.setActive(true);
              yield* Deferred.await(h.firstCheck);
              yield* TestClock.adjust("5 seconds");
              yield* Deferred.await(h.joinStarted);
              if (disable) yield* hotspot.setActive(false);
            }),
          ),
        );
        expect(interrupted).toBe(true);
        expect(h.joins()).toBe(1);
      }
    }),
  );

  it.effect("does not replace a connection that recovered while scanning", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.recoverDuringScan();
      yield* h.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const hotspot = yield* DesktopHotspot;
            yield* hotspot.initialize;
            yield* hotspot.setActive(true);
            yield* Deferred.await(h.firstCheck);
            yield* TestClock.adjust("10 seconds");
            expect(h.joins()).toBe(0);
          }),
        ),
      );
    }),
  );

  it.effect(
    "returns to a newly available known network but not immediately to the failed Wi-Fi",
    () =>
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const hotspot = yield* DesktopHotspot;
              yield* hotspot.initialize;
              yield* hotspot.setActive(true);
              yield* Deferred.await(h.firstCheck);
              yield* TestClock.adjust("5 seconds");
              h.online(true);
              yield* TestClock.adjust("30 seconds");
              expect(h.returned).toEqual([]);
              h.names(["Failed Wi-Fi", "Home"]);
              yield* TestClock.adjust("30 seconds");
              expect(h.returned).toEqual(["Home"]);
            }),
          ),
        );
      }),
  );

  it.effect("leaves another iPhone selected by the user alone even with the same gateway", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const hotspot = yield* DesktopHotspot;
            yield* hotspot.initialize;
            yield* hotspot.setActive(true);
            yield* Deferred.await(h.firstCheck);
            yield* TestClock.adjust("5 seconds");
            h.online(true);
            h.currentName("Another iPhone");
            h.names(["Home"]);
            yield* TestClock.adjust("30 seconds");
            expect(h.returned).toEqual([]);
          }),
        ),
      );
    }),
  );

  it.effect(
    "retains authorization errors while healthy and retries permission every thirty seconds",
    () =>
      Effect.gen(function* () {
        const h = yield* harness;
        h.online(true);
        h.authorize(Effect.fail(new HotspotError({ message: "Allow Location Services" })));
        yield* h.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const hotspot = yield* DesktopHotspot;
              yield* hotspot.initialize;
              yield* hotspot.setActive(true);
              yield* TestClock.adjust("25 seconds");
              expect(h.authorizations()).toBe(1);
              expect(yield* hotspot.message).toBe("Allow Location Services");
              expect(h.joins()).toBe(0);
              yield* TestClock.adjust("5 seconds");
              expect(h.authorizations()).toBe(2);
              expect(yield* hotspot.message).toBe("Allow Location Services");
              h.authorize(Effect.void);
              yield* TestClock.adjust("30 seconds");
              expect(h.authorizations()).toBe(3);
              expect(yield* hotspot.message).toBeNull();
              expect(h.checks()).toBeGreaterThan(0);
            }),
          ),
        );
      }),
  );

  it.effect("cools a failed return candidate for ten minutes and tries a different network", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.failedNames.add("Home");
      yield* h.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const hotspot = yield* DesktopHotspot;
            yield* hotspot.initialize;
            yield* hotspot.setActive(true);
            yield* Deferred.await(h.firstCheck);
            yield* TestClock.adjust("5 seconds");
            h.online(true);
            h.names(["Home"]);
            yield* TestClock.adjust("30 seconds");
            expect(h.returned).toEqual(["Home"]);
            expect(yield* hotspot.message).toBe("Could not return to known Wi-Fi.");
            yield* TestClock.adjust("30 seconds");
            expect(h.returned).toEqual(["Home"]);
            h.names(["Home", "Office"]);
            yield* TestClock.adjust("30 seconds");
            expect(h.returned).toEqual(["Home", "Office"]);
            expect(h.expectedSources).toEqual(["iPhone", "iPhone"]);
          }),
        ),
      );
    }),
  );

  it.effect("retries a cooled return only after ten minutes", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.failedNames.add("Home");
      yield* h.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const hotspot = yield* DesktopHotspot;
            yield* hotspot.initialize;
            yield* hotspot.setActive(true);
            yield* Deferred.await(h.firstCheck);
            yield* TestClock.adjust("5 seconds");
            h.online(true);
            h.names(["Home"]);
            yield* TestClock.adjust("30 seconds");
            expect(h.returned).toEqual(["Home"]);
            yield* TestClock.adjust("599 seconds");
            expect(h.returned).toEqual(["Home"]);
            h.failedNames.clear();
            yield* TestClock.adjust("1 second");
            expect(h.returned).toEqual(["Home", "Home"]);
          }),
        ),
      );
    }),
  );

  it.effect("preserves owned hotspot and original return delay across pause and resume", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const hotspot = yield* DesktopHotspot;
            yield* hotspot.initialize;
            yield* hotspot.setActive(true);
            yield* Deferred.await(h.firstCheck);
            yield* TestClock.adjust("5 seconds");
            h.online(true);
            yield* hotspot.setActive(false);
            yield* TestClock.adjust("10 minutes");
            expect(h.returned).toEqual([]);
            yield* hotspot.setActive(true);
            yield* TestClock.adjust("5 seconds");
            expect(h.returned).toEqual(["Failed Wi-Fi"]);
            expect(h.joins()).toBe(1);
          }),
        ),
      );
    }),
  );

  it.effect(
    "joins despite a failed baseline scan and treats unknown baseline networks as old",
    () =>
      Effect.gen(function* () {
        const h = yield* harness;
        h.failScan(true);
        yield* h.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const hotspot = yield* DesktopHotspot;
              yield* hotspot.initialize;
              yield* hotspot.setActive(true);
              yield* Deferred.await(h.firstCheck);
              yield* TestClock.adjust("5 seconds");
              expect(h.joins()).toBe(1);
              h.online(true);
              h.failScan(false);
              h.names(["Home"]);
              yield* TestClock.adjust("599 seconds");
              expect(h.returned).toEqual([]);
              yield* TestClock.adjust("1 second");
              expect(h.returned).toEqual(["Home"]);
            }),
          ),
        );
      }),
  );

  it.effect("rechecks Wi-Fi identity after scanning before it attempts a return", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const hotspot = yield* DesktopHotspot;
            yield* hotspot.initialize;
            yield* hotspot.setActive(true);
            yield* Deferred.await(h.firstCheck);
            yield* TestClock.adjust("5 seconds");
            h.online(true);
            h.names(["Home"]);
            h.replaceDuringScan("Another iPhone");
            yield* TestClock.adjust("30 seconds");
            expect(h.returned).toEqual([]);
          }),
        ),
      );
    }),
  );
});
