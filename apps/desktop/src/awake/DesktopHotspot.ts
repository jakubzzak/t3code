import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { HotspotSystem } from "./HotspotSystem.ts";
import {
  HOTSPOT_TICK,
  IPHONE_HOTSPOT_GATEWAY,
  RETURN_CHECK_MS,
  returnCandidate,
  retryDelay,
  type HotspotStay,
} from "./HotspotPolicy.ts";

export class DesktopHotspot extends Context.Service<
  DesktopHotspot,
  {
    readonly initialize: Effect.Effect<void, never, Scope.Scope>;
    readonly setActive: (active: boolean) => Effect.Effect<void>;
    readonly message: Effect.Effect<string | null>;
  }
>()("@t3tools/desktop/awake/DesktopHotspot") {}

/** Separate from the power heartbeat: a slow radio/permission prompt must never delay safeguards. */
export const make = Effect.gen(function* () {
  const system = yield* HotspotSystem;
  let scope: Scope.Scope | null = null;
  let worker: Fiber.Fiber<void, never> | null = null;
  let message: string | null = null;

  const follow = Effect.gen(function* () {
    let nextJoinAt: number | null = null;
    let attempts = 0;
    let stay: HotspotStay | null = null;
    let nextReturnAt = 0;
    yield* system.authorize.pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          message = error.message;
        }),
      ),
    );
    const tick = Effect.gen(function* () {
      const online = yield* system.online;
      const now = yield* Clock.currentTimeMillis;
      if (!online) {
        nextJoinAt ??= now + 5_000;
        if (now < nextJoinAt) return;
        attempts++;
        const attempt = Effect.gen(function* () {
          const knownAtJoin = yield* system.knownInRange;
          if (yield* system.online) {
            nextJoinAt = null;
            attempts = 0;
            message = null;
            return;
          }
          message = "Connecting to your iPhone hotspot…";
          const name = yield* system.join;
          stay = { name, knownAtJoin, since: yield* Clock.currentTimeMillis };
          nextReturnAt = stay.since + RETURN_CHECK_MS;
          message = "Connected to your iPhone hotspot.";
        });
        yield* attempt.pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              message = error.message;
            }),
          ),
        );
        nextJoinAt = (yield* Clock.currentTimeMillis) + retryDelay(attempts);
      } else {
        attempts = 0;
        nextJoinAt = null;
        if (stay === null) {
          message = null;
          return;
        }
        if (now < nextReturnAt) return;
        nextReturnAt = now + RETURN_CHECK_MS;
        if ((yield* system.gateway) !== IPHONE_HOTSPOT_GATEWAY) {
          stay = null;
          message = null;
          return;
        }
        const candidate = returnCandidate(stay, yield* system.knownInRange, now);
        if (candidate === undefined) return;
        // Recheck after the scan; do not override a network selected by the user meanwhile.
        if ((yield* system.gateway) !== IPHONE_HOTSPOT_GATEWAY) {
          stay = null;
          message = null;
          return;
        }
        yield* system.joinKnown(candidate);
        stay = null;
        message = "Returned to a known Wi-Fi network.";
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          message = error.message;
        }),
      ),
    );
    return yield* tick.pipe(Effect.andThen(Effect.sleep(HOTSPOT_TICK)), Effect.forever);
  });

  return DesktopHotspot.of({
    initialize: Effect.gen(function* () {
      scope = yield* Scope.Scope;
    }),
    message: Effect.sync(() => message),
    setActive: (active) =>
      Effect.gen(function* () {
        if (active && worker === null && scope !== null)
          worker = yield* follow.pipe(Effect.forkIn(scope));
        if (!active) {
          if (worker !== null) yield* Fiber.interrupt(worker);
          worker = null;
          message = null;
        }
      }),
  });
});

export const layer = Layer.effect(DesktopHotspot, make);
