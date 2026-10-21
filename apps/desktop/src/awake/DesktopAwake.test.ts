import { describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type DesktopAwakeState,
} from "@t3tools/contracts";
import { AwakeError, AwakeSystem } from "./AwakeSystem.ts";
import { DesktopAwake, layer } from "./DesktopAwake.ts";
import { DesktopClientSettings } from "../settings/DesktopClientSettings.ts";
import { ElectronWindow } from "../electron/ElectronWindow.ts";

vi.mock("electron", () => ({}));

function harness(initial: ClientSettings = DEFAULT_CLIENT_SETTINGS) {
  const calls: string[] = [];
  const states: DesktopAwakeState[] = [];
  let saved = initial;
  let battery = 80;
  let applyError = false;
  let releaseError = false;
  let lid = false;
  let installed = true;
  const system = AwakeSystem.of({
    supported: true,
    installed: Effect.sync(() => installed),
    setup: Effect.sync(() => {
      installed = true;
    }),
    remove: Effect.sync(() => {
      calls.push("remove");
      installed = false;
    }),
    apply: (_token, low) =>
      Effect.suspend(() => {
        calls.push(`apply:${low}`);
        return applyError ? Effect.fail(new AwakeError({ message: "apply failed" })) : Effect.void;
      }),
    release: () =>
      Effect.suspend(() => {
        calls.push("release");
        return releaseError
          ? Effect.fail(new AwakeError({ message: "restore failed" }))
          : Effect.void;
      }),
    battery: Effect.sync(() => ({ percent: battery, onBattery: true })),
    thermal: Effect.succeed("nominal"),
    lid: Effect.sync(() => lid),
    sleepDisplay: Effect.sync(() => {
      calls.push("display:sleep");
    }),
    wakeDisplay: Effect.sync(() => {
      calls.push("display:wake");
    }),
    holdApp: (enabled) =>
      Effect.sync(() => {
        calls.push(`assertion:${enabled}`);
      }),
  });
  const dependencies = Layer.mergeAll(
    NodeCrypto.layer,
    Layer.succeed(AwakeSystem, system),
    Layer.succeed(DesktopClientSettings, {
      get: Effect.sync(() => Option.some(saved)),
      set: (settings) =>
        Effect.sync(() => {
          saved = settings;
        }),
    }),
    Layer.succeed(ElectronWindow, {
      create: () => Effect.die("Unexpected window creation"),
      main: Effect.die("Unexpected window access"),
      currentMainOrFirst: Effect.die("Unexpected window access"),
      focusedMainOrFirst: Effect.die("Unexpected window access"),
      setMain: () => Effect.void,
      clearMain: () => Effect.void,
      prepareReveal: () => Effect.succeed(false),
      reveal: () => Effect.void,
      sendAll: (_channel, state) =>
        Effect.sync(() => {
          states.push(state as DesktopAwakeState);
        }),
      destroyAll: Effect.void,
      syncAllAppearance: () => Effect.void,
    }),
  );
  return {
    calls,
    states,
    saved: () => saved,
    battery: (percent: number) => {
      battery = percent;
    },
    lid: (closed: boolean) => {
      lid = closed;
    },
    failApply: () => {
      applyError = true;
    },
    failRelease: (value: boolean) => {
      releaseError = value;
    },
    run: <A, E>(effect: Effect.Effect<A, E, DesktopAwake>) =>
      effect.pipe(Effect.provide(layer.pipe(Layer.provide(dependencies)))),
  };
}

describe("desktop Keep awake lifecycle", () => {
  it.effect(
    "loads a saved enabled preference without any renderer and releases on scope close",
    () =>
      Effect.gen(function* () {
        const h = harness({ ...DEFAULT_CLIENT_SETTINGS, awakeEnabled: true });
        yield* h.run(
          Effect.scoped(
            Effect.gen(function* () {
              const awake = yield* DesktopAwake;
              yield* awake.initialize;
              expect((yield* awake.state).status).toBe("active");
              expect(h.calls).toContain("apply:false");
            }),
          ),
        );
        expect(h.calls.slice(-2)).toEqual(["assertion:false", "release"]);
      }),
  );
  it.effect("does no power work while disabled and ignores unrelated settings writes", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.scoped(
          Effect.gen(function* () {
            const awake = yield* DesktopAwake;
            yield* awake.initialize;
            expect(h.calls).not.toContain("apply:false");
            yield* awake.configure({ ...DEFAULT_CLIENT_SETTINGS, awakeEnabled: true });
            const count = h.calls.length;
            yield* awake.configure({
              ...DEFAULT_CLIENT_SETTINGS,
              awakeEnabled: true,
              wordWrap: false,
            });
            expect(h.calls.length).toBe(count);
            yield* awake.configure(DEFAULT_CLIENT_SETTINGS);
            expect((yield* awake.state).status).toBe("off");
            expect(h.calls.at(-1)).toBe("release");
          }),
        ),
      );
    }),
  );
  it.effect("pauses on low battery, resumes, and follows lid transitions", () =>
    Effect.gen(function* () {
      const h = harness({ ...DEFAULT_CLIENT_SETTINGS, awakeEnabled: true });
      h.lid(true);
      yield* h.run(
        Effect.scoped(
          Effect.gen(function* () {
            const awake = yield* DesktopAwake;
            yield* awake.initialize;
            expect(h.calls).toContain("display:sleep");
            h.lid(false);
            yield* awake.retry;
            expect(h.calls).toContain("display:wake");
            h.battery(5);
            yield* awake.retry;
            expect((yield* awake.state).status).toBe("paused");
            expect(h.calls.at(-1)).toBe("release");
            h.battery(30);
            yield* awake.retry;
            expect((yield* awake.state).lowPower).toBe(true);
            expect(h.calls).toContain("apply:true");
          }),
        ),
      );
    }),
  );
  it.effect("releases partially applied changes and exposes failures", () =>
    Effect.gen(function* () {
      const h = harness({ ...DEFAULT_CLIENT_SETTINGS, awakeEnabled: true });
      h.failApply();
      yield* h.run(
        Effect.scoped(
          Effect.gen(function* () {
            const awake = yield* DesktopAwake;
            yield* awake.initialize;
            expect((yield* awake.state).status).toBe("error");
            expect((yield* awake.state).message).toContain("apply failed");
            expect(h.calls).toContain("release");
            expect(h.calls).not.toContain("assertion:true");
          }),
        ),
      );
    }),
  );
  it.effect("does not claim off or uninstall when restoration failed", () =>
    Effect.gen(function* () {
      const h = harness({ ...DEFAULT_CLIENT_SETTINGS, awakeEnabled: true });
      yield* h.run(
        Effect.scoped(
          Effect.gen(function* () {
            const awake = yield* DesktopAwake;
            yield* awake.initialize;
            h.failRelease(true);
            yield* awake.configure(DEFAULT_CLIENT_SETTINGS);
            expect((yield* awake.state).status).toBe("error");
            const result = yield* awake.remove.pipe(Effect.result);
            expect(result._tag).toBe("Failure");
            expect(h.calls).not.toContain("remove");
            expect(h.saved().awakeEnabled).toBe(false);
            h.failRelease(false);
            yield* awake.retry;
            expect((yield* awake.state).status).toBe("off");
          }),
        ),
      );
    }),
  );
});
