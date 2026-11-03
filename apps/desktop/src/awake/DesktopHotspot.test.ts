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
  let gateway = "172.20.10.1";
  let join: Effect.Effect<string, HotspotError> = Effect.succeed("iPhone");
  let checks = 0;
  let joins = 0;
  let authorizations = 0;
  let scanRecovers = false;
  const returned: string[] = [];
  const system = HotspotSystem.of({
    authorize: Effect.sync(() => {
      authorizations++;
    }),
    online: Effect.sync(() => {
      checks++;
      return online;
    }).pipe(Effect.tap(() => Deferred.succeed(firstCheck, undefined))),
    knownInRange: Effect.sync(() => {
      if (scanRecovers) online = true;
      return names;
    }),
    gateway: Effect.sync(() => gateway),
    join: Effect.suspend(() => {
      joins++;
      return Deferred.succeed(joinStarted, undefined).pipe(Effect.andThen(join));
    }),
    joinKnown: (name) =>
      Effect.sync(() => {
        returned.push(name);
        gateway = "192.168.1.1";
      }),
  });
  return {
    firstCheck,
    joinStarted,
    returned,
    checks: () => checks,
    joins: () => joins,
    authorizations: () => authorizations,
    online: (value: boolean) => {
      online = value;
    },
    names: (value: string[]) => {
      names = value;
    },
    gateway: (value: string) => {
      gateway = value;
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

  it.effect("leaves a user's replacement connection alone", () =>
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
            h.gateway("192.168.2.1");
            h.names(["Home"]);
            yield* TestClock.adjust("30 seconds");
            expect(h.returned).toEqual([]);
          }),
        ),
      );
    }),
  );
});
