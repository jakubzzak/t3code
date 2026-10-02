import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import {
  TextGenerationError,
  type FileFilterGenerationInput,
  type FileFilterGenerationResult,
} from "@t3tools/contracts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export class FileFilterService extends Context.Service<
  FileFilterService,
  {
    readonly generate: (
      input: FileFilterGenerationInput,
    ) => Effect.Effect<FileFilterGenerationResult, TextGenerationError>;
  }
>()("t3/review/FileFilterService") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const generation = yield* TextGeneration.TextGeneration;
  const fs = yield* FileSystem.FileSystem;

  const generate = Effect.fn("FileFilterService.generate")(function* (
    input: FileFilterGenerationInput,
  ) {
    const config = yield* settings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: "generateFileFilter",
            detail: "Could not read text generation settings.",
            cause,
          }),
      ),
    );
    // Filename rules need no repository context or access to the active checkout.
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-file-filter-" }).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: "generateFileFilter",
            detail: "Could not prepare file filter generation.",
            cause,
          }),
      ),
    );
    const result = yield* generation.generateFileFilter({
      ...input,
      cwd,
      modelSelection: config.textGenerationModelSelection,
    });
    yield* Effect.try({
      try: () => new RegExp(result.regex),
      catch: (cause) =>
        new TextGenerationError({
          operation: "generateFileFilter",
          detail: "The agent returned an invalid regular expression. Try rephrasing your request.",
          cause,
        }),
    });
    return result;
  }, Effect.scoped);

  return FileFilterService.of({ generate });
});

export const layer = Layer.effect(FileFilterService, make);
