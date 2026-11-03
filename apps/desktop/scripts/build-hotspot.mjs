import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

// oxlint-disable-next-line t3code/no-global-process-runtime -- Native compilation targets the build host.
const hostPlatform = process.platform;
// oxlint-disable-next-line t3code/no-global-process-runtime -- Defaults to the architecture of the actual development host.
const hostArch = process.arch;
const { values } = NodeUtil.parseArgs({
  options: { output: { type: "string" }, arch: { type: "string", default: hostArch } },
});

if (hostPlatform === "darwin") {
  const architectures = { arm64: ["arm64"], x64: ["x86_64"], universal: ["arm64", "x86_64"] }[
    values.arch
  ];
  if (!architectures) throw new Error(`Unsupported macOS architecture: ${values.arch}`);
  const repoRoot = NodeURL.fileURLToPath(new URL("../../../", import.meta.url));
  const source = NodePath.join(repoRoot, "native/hotspot/hotspot.m");
  const plist = NodePath.join(repoRoot, "native/hotspot/Info.plist");
  const app =
    values.output ??
    NodePath.join(repoRoot, "apps/desktop/resources/hotspot/Blackbird Hotspot.app");
  const executable = NodePath.join(app, "Contents/MacOS/blackbird-hotspot");
  const identity = process.env.T3CODE_MACOS_SIGNING_IDENTITY?.trim() || "-";
  const script = NodeURL.fileURLToPath(import.meta.url);
  const stamp = NodePath.join(app, "Contents/Resources/build.json");
  const signature = JSON.stringify({ architectures, identity });
  let current = false;
  try {
    current =
      NodeFS.readFileSync(stamp, "utf8") === signature &&
      NodeFS.statSync(executable).mtimeMs >=
        Math.max(...[source, plist, script].map((file) => NodeFS.statSync(file).mtimeMs));
    if (current) {
      NodeChildProcess.execFileSync("codesign", ["--verify", "--strict", app], { stdio: "pipe" });
    }
  } catch {
    current = false;
  }
  if (!current) {
    NodeFS.mkdirSync(NodePath.dirname(app), { recursive: true });
    const staging = NodeFS.mkdtempSync(NodePath.join(NodePath.dirname(app), ".hotspot-build-"));
    const temporary = NodePath.join(staging, "Blackbird Hotspot.app");
    try {
      const macos = NodePath.join(temporary, "Contents/MacOS");
      NodeFS.mkdirSync(macos, { recursive: true });
      NodeFS.mkdirSync(NodePath.join(temporary, "Contents/Resources"), { recursive: true });
      NodeFS.copyFileSync(plist, NodePath.join(temporary, "Contents/Info.plist"));
      const binary = NodePath.join(macos, "blackbird-hotspot");
      NodeChildProcess.execFileSync(
        "xcrun",
        [
          "clang",
          "-fobjc-arc",
          "-fblocks",
          "-O2",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-mmacosx-version-min=12.0",
          ...architectures.flatMap((arch) => ["-arch", arch]),
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
          binary,
        ],
        { stdio: "inherit" },
      );
      NodeFS.writeFileSync(NodePath.join(temporary, "Contents/Resources/build.json"), signature);
      NodeChildProcess.execFileSync(
        "codesign",
        ["--force", "--sign", identity, "--timestamp=none", temporary],
        { stdio: "inherit" },
      );
      NodeChildProcess.execFileSync("codesign", ["--verify", "--strict", temporary], {
        stdio: "inherit",
      });
      NodeFS.rmSync(app, { recursive: true, force: true });
      NodeFS.renameSync(temporary, app);
    } finally {
      NodeFS.rmSync(staging, { recursive: true, force: true });
    }
  }
}
