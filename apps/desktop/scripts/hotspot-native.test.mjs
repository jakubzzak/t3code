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
  let fixture;
  const script = NodeURL.fileURLToPath(new URL("./build-hotspot.mjs", import.meta.url));
  beforeAll(() => {
    directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "blackbird-hotspot-test-"));
    fixture = NodePath.join(directory, "ownership-fixture");
    const source = NodeURL.fileURLToPath(
      new URL("../../../native/hotspot/ownership.test.m", import.meta.url),
    );
    NodeChildProcess.execFileSync(
      "xcrun",
      [
        "clang",
        "-fobjc-arc",
        "-fblocks",
        "-Wall",
        "-Wextra",
        "-Werror",
        source,
        "-framework",
        "Foundation",
        "-framework",
        "CoreLocation",
        "-framework",
        "CoreWLAN",
        "-framework",
        "Security",
        "-o",
        fixture,
      ],
      { stdio: "pipe" },
    );
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
    const signedEntitlements = NodeChildProcess.execFileSync(
      "codesign",
      ["--display", "--entitlements", "-", app],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(signedEntitlements).toContain("com.apple.security.personal-information.location");
    const signing = NodeChildProcess.spawnSync("codesign", ["--display", "--verbose=4", app], {
      encoding: "utf8",
    });
    expect(signing.stderr).toContain("runtime");
    // Cached dev builds must preserve the signed bundle instead of changing its
    // identity on every JavaScript rebuild and invalidating Location permission.
    const modified = NodeFS.statSync(binary).mtimeMs;
    NodeChildProcess.execFileSync(process.execPath, args, {
      env: { ...process.env, T3CODE_MACOS_SIGNING_IDENTITY: "-" },
      stdio: "pipe",
    });
    expect(NodeFS.statSync(binary).mtimeMs).toBe(modified);
  });

  it("returns only from the hotspot it owns, including after a slow scan", () => {
    const lease = NodePath.join(directory, "ownership-lease");
    NodeFS.writeFileSync(lease, "");
    const result = NodeChildProcess.spawnSync(fixture, ["ownership", lease], {
      encoding: "utf8",
      timeout: 2_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('{"name":"Home"}\n');
  });

  it.each([
    ["unauthorized-status", { authorized: false, name: null }],
    ["disconnected-status", { authorized: true, name: null }],
    ["connected-status", { authorized: true, name: "Phone" }],
  ])("reports %s without requesting permission", (scenario, expected) => {
    const result = NodeChildProcess.spawnSync(fixture, [scenario, "/unused-fixture-lease"], {
      encoding: "utf8",
      timeout: 2_000,
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(expected);
    expect(result.stderr).toBe("");
  });

  it("stops a pending helper when its owning app removes the lease", async () => {
    const lease = NodePath.join(directory, "pending-lease");
    NodeFS.writeFileSync(lease, "");
    const result = await new Promise((resolve, reject) => {
      const child = NodeChildProcess.spawn(fixture, ["waiting-authorization", lease], {
        timeout: 2_000,
      });
      child.once("error", reject);
      child.stderr.on("data", (data) => {
        if (data.toString().includes("authorization-waiting"))
          NodeFS.rmSync(lease, { force: true });
      });
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    expect(result).toEqual({ code: 1, signal: null });
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
    const lease = NodePath.join(directory, "lease");
    NodeFS.writeFileSync(lease, "");
    for (const args of [
      [],
      ["unknown"],
      ["join", "extra"],
      ["join-known"],
      ["join-known", ""],
      ["--lease", lease, "join-known", "Target"],
      ["--lease", lease, "join-known", "Target", ""],
      ["--lease", lease, "join-known", "Target", "x".repeat(33)],
      ["--lease", lease, "join-known", "x".repeat(33), "Phone"],
      ["--lease", "relative", "status"],
    ]) {
      const result = NodeChildProcess.spawnSync(binary, args, { encoding: "utf8", timeout: 2_000 });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage:");
    }
    // Existing arguments with a removed lease must fail before touching radios,
    // the Keychain or permission requests—even for otherwise valid join modes.
    NodeFS.rmSync(lease);
    for (const args of [
      ["join"],
      ["scan"],
      ["status"],
      ["authorize"],
      ["join-known", "Target", "Phone"],
    ]) {
      const result = NodeChildProcess.spawnSync(binary, ["--lease", lease, ...args], {
        encoding: "utf8",
        timeout: 2_000,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("cancelled");
    }
    const help = NodeChildProcess.spawnSync(binary, ["--help"], {
      encoding: "utf8",
      timeout: 2_000,
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("join-known SSID EXPECTED_HOTSPOT");
    expect(help.stderr).toBe("");
  });
});
