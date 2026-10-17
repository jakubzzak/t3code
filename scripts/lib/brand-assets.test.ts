import { describe, expect, it } from "vite-plus/test";

import {
  BRAND_ASSET_PATHS,
  BLACKBIRD_ASSET_PATHS,
  DEVELOPMENT_ICON_OVERRIDES,
  DEVELOPMENT_PUBLIC_ICON_OVERRIDES,
  resolveWebAssetBrandForChannel,
  resolveWebAssetBrandForPackageVersion,
  resolveWebIconOverrides,
} from "./brand-assets.ts";

describe("brand-assets", () => {
  it("maps production web assets into the server package", () => {
    expect(resolveWebIconOverrides("production", "dist/client")).toEqual([
      {
        sourceRelativePath: BLACKBIRD_ASSET_PATHS.faviconIco,
        targetRelativePath: "dist/client/favicon.ico",
      },
      {
        sourceRelativePath: BLACKBIRD_ASSET_PATHS.favicon16Png,
        targetRelativePath: "dist/client/favicon-16x16.png",
      },
      {
        sourceRelativePath: BLACKBIRD_ASSET_PATHS.favicon32Png,
        targetRelativePath: "dist/client/favicon-32x32.png",
      },
      {
        sourceRelativePath: BLACKBIRD_ASSET_PATHS.appleTouchIconPng,
        targetRelativePath: "dist/client/apple-touch-icon.png",
      },
    ]);
  });

  it("keeps Blackbird icons in development server builds", () => {
    expect(DEVELOPMENT_ICON_OVERRIDES[0]).toEqual({
      sourceRelativePath: BLACKBIRD_ASSET_PATHS.faviconIco,
      targetRelativePath: "dist/client/favicon.ico",
    });
  });

  it("maps development web assets to the public splash and favicon files", () => {
    expect(DEVELOPMENT_PUBLIC_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: BLACKBIRD_ASSET_PATHS.faviconIco,
        targetRelativePath: "apps/web/public/favicon.ico",
      },
      {
        sourceRelativePath: BLACKBIRD_ASSET_PATHS.favicon16Png,
        targetRelativePath: "apps/web/public/favicon-16x16.png",
      },
      {
        sourceRelativePath: BLACKBIRD_ASSET_PATHS.favicon32Png,
        targetRelativePath: "apps/web/public/favicon-32x32.png",
      },
      {
        sourceRelativePath: BLACKBIRD_ASSET_PATHS.appleTouchIconPng,
        targetRelativePath: "apps/web/public/apple-touch-icon.png",
      },
    ]);
  });

  it("can target hosted web dist directly", () => {
    expect(resolveWebIconOverrides("production", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BLACKBIRD_ASSET_PATHS.appleTouchIconPng,
      targetRelativePath: "apps/web/dist/apple-touch-icon.png",
    });
  });

  it("keeps Blackbird icons in hosted nightly builds", () => {
    expect(resolveWebIconOverrides("nightly", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BLACKBIRD_ASSET_PATHS.faviconIco,
      targetRelativePath: "apps/web/dist/favicon.ico",
    });
  });

  it("maps hosted release channels to web asset brands", () => {
    expect(resolveWebAssetBrandForChannel("latest")).toBe("production");
    expect(resolveWebAssetBrandForChannel("nightly")).toBe("nightly");
  });

  it("maps package versions to web asset brands", () => {
    expect(resolveWebAssetBrandForPackageVersion("0.0.29")).toBe("production");
    expect(resolveWebAssetBrandForPackageVersion("0.0.29-nightly.20260723.882")).toBe("nightly");
    expect(resolveWebAssetBrandForPackageVersion("0.0.29-preview.20260723.882")).toBe("nightly");
  });

  it("keeps development, nightly, and production icon families separate", () => {
    expect([
      BRAND_ASSET_PATHS.developmentIconComposerProject,
      BRAND_ASSET_PATHS.nightlyIconComposerProject,
      BRAND_ASSET_PATHS.productionIconComposerProject,
    ]).toEqual([
      "assets/dev/app-icon.icon",
      "assets/nightly/app-icon.icon",
      "assets/prod/app-icon.icon",
    ]);
    expect(BRAND_ASSET_PATHS.developmentDesktopIconPng).toMatch(/^assets\/dev\/blueprint-/);
    expect(BRAND_ASSET_PATHS.nightlyMacIconPng).toMatch(/^assets\/nightly\/nightly-/);
    expect(BRAND_ASSET_PATHS.productionMacIconPng).toMatch(/^assets\/prod\/black-/);
  });
});
