#!/usr/bin/env node

// Keep the Blackbird artwork inside Android's adaptive icon and splash masks.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

import { BLACKBIRD_ASSET_PATHS } from "./lib/brand-assets.ts";

export class AndroidIconRenderError extends Schema.TaggedError<AndroidIconRenderError>()(
  "AndroidIconRenderError",
  { layer: Schema.String, cause: Schema.Defect() },
) {}

const renderIcon = (source: string, size: number, monochrome = false) =>
  Effect.tryPromise({
    try: async () => {
      // Android guarantees the central 66dp of its 108dp adaptive canvas.
      const artworkSize = Math.round(size * 0.6);
      const inset = Math.floor((size - artworkSize) / 2);
      const artwork = await sharp(source).resize(artworkSize, artworkSize).png().toBuffer();
      const canvas = await sharp({
        create: { width: size, height: size, channels: 4, background: "#000000" },
      })
        .composite([{ input: artwork, left: inset, top: inset }])
        .png()
        .toBuffer();
      if (!monochrome) return canvas;
      // The silver artwork on black supplies the alpha mask for themed icons
      // and notifications, which Android tints to match the system appearance.
      const alpha = await sharp(canvas).removeAlpha().greyscale().threshold(32).raw().toBuffer();
      return sharp({
        create: { width: size, height: size, channels: 3, background: "#ffffff" },
      })
        .joinChannel(alpha, { raw: { width: size, height: size, channels: 1 } })
        .png()
        .toBuffer();
    },
    catch: (cause) => new AndroidIconRenderError({ layer: "blackbird", cause }),
  });

const exportAndroidIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const source = path.join(repositoryRoot, BLACKBIRD_ASSET_PATHS.iconPng);
  const splash = yield* renderIcon(source, 1152);
  const outputs = [
    ["android-icon-foreground.png", yield* renderIcon(source, 432)],
    ["android-icon-mark.png", yield* renderIcon(source, 432, true)],
    ["android-notification-icon.png", yield* renderIcon(source, 96, true)],
    ["android-splash-icon-dev.png", splash],
    ["android-splash-icon-nightly.png", splash],
    ["android-splash-icon-prod.png", splash],
  ] as const;
  for (const [name, contents] of outputs) {
    const output = path.join("apps/mobile/assets", name);
    yield* fs.writeFile(path.join(repositoryRoot, output), contents);
    yield* Console.log(`wrote ${output}`);
  }
});

if (import.meta.main) {
  exportAndroidIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
