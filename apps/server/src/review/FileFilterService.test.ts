import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, TextGenerationError } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { describe, expect } from "vite-plus/test";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as FileFilterService from "./FileFilterService.ts";

const input = { prompt: "Only TypeScript files, excluding tests", currentRegex: "" };
const makeLayer = (
  generateFileFilter: TextGeneration.TextGeneration["Service"]["generateFileFilter"],
) =>
  FileFilterService.layer.pipe(
    Layer.provide(Layer.mock(TextGeneration.TextGeneration)({ generateFileFilter })),
    Layer.provide(
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

describe("FileFilterService", () => {
  it.effect(
    "uses the configured model in a temporary directory and cleans up after success",
    () => {
      let directory = "";
      return Effect.gen(function* () {
        const service = yield* FileFilterService.FileFilterService;
        const fs = yield* FileSystem.FileSystem;
        const result = yield* service.generate(input);
        expect(result.regex).toBe(String.raw`^(?!.*\.(spec|test)\.).*\.ts$`);
        expect(yield* fs.exists(directory)).toBe(false);
      }).pipe(
        Effect.provide(
          makeLayer((request) =>
            Effect.gen(function* () {
              directory = request.cwd;
              const fs = yield* FileSystem.FileSystem;
              expect(yield* fs.exists(directory)).toBe(true);
              expect(request.modelSelection).toEqual(
                DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
              );
              expect(request.prompt).toBe(input.prompt);
              expect(request.currentRegex).toBe(input.currentRegex);
              return { regex: String.raw`^(?!.*\.(spec|test)\.).*\.ts$` };
            }).pipe(Effect.provide(NodeServices.layer), Effect.orDie),
          ),
        ),
      );
    },
  );

  it.effect("rejects invalid generated regex", () =>
    Effect.gen(function* () {
      const service = yield* FileFilterService.FileFilterService;
      const result = yield* Effect.result(service.generate(input));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result))
        expect(result.failure.detail).toContain("invalid regular expression");
    }).pipe(Effect.provide(makeLayer(() => Effect.succeed({ regex: "[" })))),
  );

  it.effect("preserves provider failure details", () =>
    Effect.gen(function* () {
      const service = yield* FileFilterService.FileFilterService;
      const result = yield* Effect.result(service.generate(input));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.detail).toBe("Provider unavailable");
    }).pipe(
      Effect.provide(
        makeLayer(() =>
          Effect.fail(
            new TextGenerationError({
              operation: "generateFileFilter",
              detail: "Provider unavailable",
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("interrupts generation and releases its temporary directory", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<string>();
      const interrupted = yield* Deferred.make<void>();
      const layer = makeLayer((request) =>
        Deferred.succeed(started, request.cwd).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        ),
      );
      yield* Effect.gen(function* () {
        const service = yield* FileFilterService.FileFilterService;
        const fs = yield* FileSystem.FileSystem;
        const fiber = yield* service.generate(input).pipe(Effect.forkChild);
        const directory = yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        yield* Deferred.await(interrupted);
        expect(yield* fs.exists(directory)).toBe(false);
      }).pipe(Effect.provide(layer));
    }),
  );
});
