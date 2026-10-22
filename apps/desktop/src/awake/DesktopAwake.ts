import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  DesktopAwakeState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import { DesktopClientSettings } from "../settings/DesktopClientSettings.ts";
import { ElectronWindow } from "../electron/ElectronWindow.ts";
import { AWAKE_STATE_CHANNEL } from "../ipc/channels.ts";
import { AwakeError, AwakeSystem } from "./AwakeSystem.ts";
import { decideAwake } from "./AwakePolicy.ts";

export class DesktopAwake extends Context.Service<
  DesktopAwake,
  {
    readonly initialize: Effect.Effect<void, never, Scope.Scope>;
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
    readonly state: Effect.Effect<DesktopAwakeState>;
    readonly setup: Effect.Effect<DesktopAwakeState, AwakeError>;
    readonly remove: Effect.Effect<DesktopAwakeState, AwakeError>;
    readonly retry: Effect.Effect<DesktopAwakeState>;
  }
>()("@t3tools/desktop/awake/DesktopAwake") {}

const sameState = Schema.toEquivalence(DesktopAwakeState);

/** @public Main-process ownership keeps closed windows and renderer reloads irrelevant. */
export const make = Effect.gen(function* () {
  const system = yield* AwakeSystem;
  const clientSettings = yield* DesktopClientSettings;
  const windows = yield* ElectronWindow;
  const crypto = yield* Crypto.Crypto;
  const token = (yield* crypto.randomUUIDv4().pipe(Effect.orDie)).replaceAll("-", "");
  const lock = yield* Semaphore.make(1);
  let settings = DEFAULT_CLIENT_SETTINGS;
  let current: DesktopAwakeState = {
    supported: system.supported,
    installed: false,
    status: "off",
    lowPower: false,
    message: null,
  };
  let ownsSession = false;
  let failed = false;
  let lidWasClosed = false;

  const publish = Effect.fnUntraced(function* (next: DesktopAwakeState) {
    if (sameState(next, current)) return;
    current = next;
    yield* windows.sendAll(AWAKE_STATE_CHANNEL, next);
  });
  const release = Effect.gen(function* () {
    yield* system.holdApp(false);
    if (ownsSession) {
      yield* system.release(token);
      ownsSession = false;
    }
    lidWasClosed = false;
  });
  const onError = Effect.fnUntraced(function* (error: AwakeError) {
    failed = true;
    let message = error.message;
    yield* release.pipe(
      Effect.catch((restoreError) =>
        Effect.sync(() => {
          message += ` Recovery is still pending: ${restoreError.message}`;
        }),
      ),
    );
    yield* publish({ ...current, status: "error", lowPower: false, message });
  });
  const reconcile = Effect.gen(function* () {
    if (!system.supported) return;
    if (!settings.awakeEnabled) {
      yield* release;
      failed = false;
      return yield* publish({ ...current, status: "off", lowPower: false, message: null });
    }
    if (failed) return;
    if (!current.installed)
      return yield* publish({
        ...current,
        status: "paused",
        message: "Set up Keep awake on this Mac first.",
      });
    const decision = decideAwake(settings, yield* system.battery, yield* system.thermal);
    if (!decision.active) {
      yield* release;
      return yield* publish({
        ...current,
        status: "paused",
        lowPower: false,
        message: decision.message,
      });
    }
    if (current.status !== "active")
      yield* publish({ ...current, status: "starting", message: null });
    // A failed apply may already have changed power policy; release must still run.
    ownsSession = true;
    yield* system.apply(token, decision.lowPower);
    yield* system.holdApp(true);
    const closed = yield* system.lid;
    if (closed === true && !lidWasClosed) yield* system.sleepDisplay;
    if (closed === false && lidWasClosed) yield* system.wakeDisplay;
    if (closed !== null) lidWasClosed = closed;
    yield* publish({ ...current, status: "active", lowPower: decision.lowPower, message: null });
  });
  const tick = reconcile.pipe(Effect.catch(onError));
  const inspect = Effect.gen(function* () {
    const installed = yield* system.installed;
    yield* publish({ ...current, installed });
  });

  return DesktopAwake.of({
    state: Effect.sync(() => current),
    initialize: Effect.gen(function* () {
      if (!system.supported) return;
      yield* Effect.addFinalizer(() => lock.withPermits(1)(release).pipe(Effect.catch(onError)));
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const saved = yield* clientSettings.get.pipe(
            Effect.mapError(
              () => new AwakeError({ message: "Could not read Keep awake preferences." }),
            ),
          );
          settings = Option.getOrElse(saved, () => DEFAULT_CLIENT_SETTINGS);
          yield* inspect;
          yield* tick;
        }).pipe(Effect.catch(onError)),
      );
      yield* Effect.sleep("10 seconds").pipe(
        Effect.andThen(
          lock.withPermits(1)(
            Effect.suspend(() => (settings.awakeEnabled && !failed ? tick : Effect.void)),
          ),
        ),
        Effect.forever,
        Effect.forkScoped,
      );
    }),
    configure: (next) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const changed =
            settings.awakeEnabled !== next.awakeEnabled ||
            settings.awakeHeatRules !== next.awakeHeatRules ||
            settings.awakeLowPowerBelowPercent !== next.awakeLowPowerBelowPercent ||
            settings.awakeSleepBelowPercent !== next.awakeSleepBelowPercent;
          settings = next;
          if (!changed) return;
          failed = false;
          yield* tick;
        }),
      ),
    setup: lock.withPermits(1)(
      Effect.gen(function* () {
        yield* system.setup;
        yield* inspect;
        failed = false;
        yield* tick;
        return current;
      }).pipe(
        Effect.tapError((error) => inspect.pipe(Effect.ignore, Effect.andThen(onError(error)))),
      ),
    ),
    remove: lock.withPermits(1)(
      Effect.gen(function* () {
        // Persist off first: cancellation or a failed removal must not reactivate on restart.
        const next = { ...settings, awakeEnabled: false };
        yield* clientSettings
          .set(next)
          .pipe(
            Effect.mapError(
              () => new AwakeError({ message: "Could not save Keep awake preferences." }),
            ),
          );
        settings = next;
        yield* release;
        yield* publish({ ...current, status: "off", lowPower: false, message: null });
        yield* system.remove;
        yield* publish({ ...current, installed: false });
        return current;
      }).pipe(Effect.tapError(onError)),
    ),
    retry: lock.withPermits(1)(
      Effect.gen(function* () {
        failed = false;
        yield* inspect.pipe(Effect.andThen(tick), Effect.catch(onError));
        return current;
      }),
    ),
  });
});

export const layer = Layer.effect(DesktopAwake, make);
