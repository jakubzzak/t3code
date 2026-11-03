import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

// oxlint-disable-next-line t3code/no-global-process-runtime -- These tests invoke the actual macOS toolchain only on macOS.
const hostPlatform = process.platform;

describe.skipIf(hostPlatform !== "darwin")("bundled Instant Hotspot helper", () => {
  let directory;
  const script = NodeURL.fileURLToPath(new URL("./build-hotspot.mjs", import.meta.url));
  beforeAll(() => {
    directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "blackbird-hotspot-test-"));
  });
  afterAll(() => {
    if (directory) NodeFS.rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    ["arm64", ["arm64"]],
    ["x64", ["x86_64"]],
    ["universal", ["arm64", "x86_64"]],
  ])("packages a signed %s helper with Location permission metadata", (arch, expected) => {
    const app = NodePath.join(directory, arch, "Blackbird Hotspot.app");
    const binary = NodePath.join(app, "Contents/MacOS/blackbird-hotspot");
    const args = [script, "--arch", arch, "--output", app];
    NodeChildProcess.execFileSync(process.execPath, args, {
      env: { ...process.env, T3CODE_MACOS_SIGNING_IDENTITY: "-" },
      stdio: "pipe",
    });
    const architectures = NodeChildProcess.execFileSync("lipo", ["-archs", binary], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .sort();
    expect(architectures).toEqual([...expected].sort());
    NodeChildProcess.execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
    const plist = JSON.parse(
      NodeChildProcess.execFileSync(
        "plutil",
        ["-convert", "json", "-o", "-", NodePath.join(app, "Contents/Info.plist")],
        { encoding: "utf8" },
      ),
    );
    expect(plist.CFBundleIdentifier).toBe("com.blackbird.hotspot");
    expect(plist.CFBundleExecutable).toBe("blackbird-hotspot");
    expect(plist.NSLocationWhenInUseUsageDescription).toContain("connect to your iPhone hotspot");
    expect(NodeFS.statSync(binary).mode & 0o111).not.toBe(0);
    // Cached dev builds must preserve the signed bundle instead of changing its
    // identity on every JavaScript rebuild and invalidating Location permission.
    const modified = NodeFS.statSync(binary).mtimeMs;
    NodeChildProcess.execFileSync(process.execPath, args, {
      env: { ...process.env, T3CODE_MACOS_SIGNING_IDENTITY: "-" },
      stdio: "pipe",
    });
    expect(NodeFS.statSync(binary).mtimeMs).toBe(modified);
  });

  it("rejects invalid CLI input without scanning, prompting or joining", () => {
    const app = NodePath.join(directory, "cli", "Blackbird Hotspot.app");
    NodeChildProcess.execFileSync(
      process.execPath,
      [script, "--arch", "universal", "--output", app],
      {
        env: { ...process.env, T3CODE_MACOS_SIGNING_IDENTITY: "-" },
        stdio: "pipe",
      },
    );
    const binary = NodePath.join(app, "Contents/MacOS/blackbird-hotspot");
    for (const args of [
      [],
      ["unknown"],
      ["join", "extra"],
      ["join-known"],
      ["join-known", ""],
      ["join-known", "x".repeat(33)],
    ]) {
      const result = NodeChildProcess.spawnSync(binary, args, { encoding: "utf8", timeout: 2_000 });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage:");
    }
    const help = NodeChildProcess.spawnSync(binary, ["--help"], {
      encoding: "utf8",
      timeout: 2_000,
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("join-known SSID");
    expect(help.stderr).toBe("");
  });
});
