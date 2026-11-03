import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import sign from "./sign-macos.ts";

vi.mock("@electron/osx-sign", () => ({ sign: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

const baseOptions = {
  app: "/tmp/Blackbird.app",
  identity: "Developer ID Application: T3 Tools, Inc.",
  keychain: "/tmp/t3code.keychain",
  provisioningProfile: "/tmp/t3code.provisionprofile",
} satisfies SignOptions;

function signedOptions() {
  const options = vi.mocked(signApplication).mock.calls[0]?.[0];
  if (!options?.optionsForFile) throw new Error("Missing per-file signing callback");
  return options;
}

describe("macOS signing", () => {
  it("batches codesign calls and preserves ordinary app and nested binary options", async () => {
    const inherited = {
      entitlements: "/tmp/t3code.entitlements.plist",
      hardenedRuntime: true,
      requirements: "anchor apple generic",
    };
    const optionsForFile = vi.fn(() => inherited);
    await sign({ ...baseOptions, optionsForFile });

    expect(signApplication).toHaveBeenCalledOnce();
    expect(signedOptions()).toMatchObject({ ...baseOptions, batchCodesignCalls: true });
    for (const file of [
      baseOptions.app,
      `${baseOptions.app}/Contents/MacOS/Blackbird`,
      `${baseOptions.app}/Contents/Frameworks/Blackbird Helper.app`,
      `${baseOptions.app}/Contents/Resources/hotspot/Blackbird Hotspot.app.other`,
      "/tmp/Elsewhere/Blackbird Hotspot.app",
    ]) {
      expect(signedOptions().optionsForFile?.(file)).toBe(inherited);
      expect(optionsForFile).toHaveBeenLastCalledWith(file);
    }
  });

  it("grants only the native hotspot bundle Location access under hardened runtime", async () => {
    const inherited = {
      entitlements: "/tmp/electron-inherit.plist",
      hardenedRuntime: false,
      requirements: "anchor apple generic",
    };
    await sign({ ...baseOptions, optionsForFile: () => inherited });

    const helper = `${baseOptions.app}/Contents/Resources/hotspot/Blackbird Hotspot.app`;
    for (const file of [helper, `${helper}/Contents/MacOS/blackbird-hotspot`]) {
      const options = signedOptions().optionsForFile?.(file);
      expect(options).toEqual({
        ...inherited,
        hardenedRuntime: true,
        entitlements: NodePath.resolve(import.meta.dirname, "../native/hotspot/entitlements.plist"),
      });
      const plist = NodeFS.readFileSync(options?.entitlements as string, "utf8");
      expect(plist).toMatch(
        /<key>com\.apple\.security\.personal-information\.location<\/key>\s*<true\s*\/>/,
      );
      expect(plist).not.toContain("allow-unsigned-executable-memory");
      expect(plist).not.toContain("disable-library-validation");
    }
  });

  it("keeps signing defaults outside the helper when there is no inherited callback", async () => {
    await sign(baseOptions);
    expect(signedOptions().optionsForFile?.(baseOptions.app)).toEqual({});
    expect(
      signedOptions().optionsForFile?.(
        `${baseOptions.app}/Contents/Resources/hotspot/Blackbird Hotspot.app`,
      ),
    ).toMatchObject({ hardenedRuntime: true, entitlements: expect.any(String) });
  });
});
