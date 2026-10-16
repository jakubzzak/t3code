// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Local macOS packaging uses host tools before starting the app.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { loadRepoEnv } from "./lib/public-config.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");

async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? code}).`));
    });
  });
}

async function installDesktop(): Promise<void> {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- This installer targets the actual host Mac.
  if (process.platform !== "darwin") throw new Error("This action requires macOS.");
  const env = loadRepoEnv();
  // Project actions inherit the running dev app's environment, including its launch hooks.
  for (const key of [
    "T3CODE_DESKTOP_DEV",
    "VITE_DEV_SERVER_URL",
    "VITE_HTTP_URL",
    "VITE_WS_URL",
    "ELECTRON_RUN_AS_NODE",
    "T3CODE_DESKTOP_VERSION",
  ])
    delete env[key];
  env.PATH = [env.PATH, NodePath.join(NodeOS.homedir(), ".cargo", "bin")]
    .filter(Boolean)
    .join(NodePath.delimiter);
  env.T3CODE_DESKTOP_SKIP_BUILD = "false";
  env.T3CODE_DESKTOP_SIGNED = "false";
  env.T3CODE_DESKTOP_MOCK_UPDATES = "false";

  const identities = NodeChildProcess.execFileSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf8", env },
  );
  const signingIdentity =
    env.T3CODE_MACOS_SIGNING_IDENTITY?.trim() ||
    identities.match(
      /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(?:Apple Development|Developer ID Application):/m,
    )?.[1] ||
    "-";
  console.log(
    signingIdentity === "-"
      ? "No Apple signing identity found. Using ad-hoc signing; macOS privacy permissions may need to be granted again after each rebuild."
      : "Using a Keychain signing identity to preserve app identity across rebuilds.",
  );

  const applicationsDir = "/Applications";
  const dataDir = NodePath.join(NodeOS.homedir(), ".t3-local-build");
  const stage = await NodeFSP.mkdtemp(NodePath.join(applicationsDir, ".t3code-install-"));
  let previousApp: string | undefined;
  let destination: string | undefined;
  let installed = false;
  try {
    const artifacts = NodePath.join(stage, "artifacts");
    console.log("Building the macOS app with this checkout's .env.local...");
    await run(
      process.execPath,
      [
        "scripts/build-desktop-artifact.ts",
        "--platform",
        "mac",
        "--target",
        "zip",
        "--arch",
        // oxlint-disable-next-line t3code/no-global-process-runtime -- Package the host architecture.
        process.arch,
        "--output-dir",
        artifacts,
        "--verbose",
      ],
      env,
    );

    const archives = (await NodeFSP.readdir(artifacts)).filter((name) => name.endsWith(".zip"));
    if (archives.length !== 1) throw new Error("Expected one desktop ZIP from the build.");
    const unpacked = NodePath.join(stage, "unpacked");
    await run("ditto", ["-x", "-k", NodePath.join(artifacts, archives[0]!), unpacked], env);
    const apps = (await NodeFSP.readdir(unpacked)).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1) throw new Error("Expected one app in the desktop ZIP.");
    const appName = apps[0]!;
    const stagedApp = NodePath.join(unpacked, appName);
    destination = NodePath.join(applicationsDir, appName);

    // Finder/Dock launches need the same isolated data directory as the first launch.
    const plist = NodePath.join(stagedApp, "Contents", "Info.plist");
    await run(
      "plutil",
      [
        "-replace",
        "LSEnvironment",
        "-json",
        JSON.stringify({
          MallocNanoZone: "0",
          T3CODE_HOME: dataDir,
        }),
        plist,
      ],
      env,
    );
    await run(
      "codesign",
      ["--force", "--deep", "--sign", signingIdentity, "--timestamp=none", stagedApp],
      env,
    );
    await run("codesign", ["--verify", "--deep", "--strict", stagedApp], env);

    console.log(`Installing ${destination} (app data: ${dataDir})...`);
    // Match the installed bundle path, so development instances stay running.
    await run(
      "osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        `
      ObjC.import('AppKit');
      function run(argv) {
        const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
        for (let i = 0; i < apps.count; i++) {
          const app = apps.objectAtIndex(i);
          if (app.bundleURL.isNil() || ObjC.unwrap(app.bundleURL.path) !== argv[0]) continue;
          if (!app.terminate) throw new Error('Could not quit the installed app. Quit it and retry.');
          const deadline = Date.now() + 15000;
          while (!app.isTerminated) {
            if (Date.now() >= deadline) throw new Error('The installed app is still running. Quit it and retry.');
            delay(0.25);
          }
        }
      }
    `,
        destination,
      ],
      env,
    );

    try {
      await NodeFSP.rename(destination, NodePath.join(stage, appName));
      previousApp = NodePath.join(stage, appName);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    await NodeFSP.rename(stagedApp, destination);
    installed = true;
    console.log(`Installed ${destination}`);
    await run("open", ["-n", "--env", `T3CODE_HOME=${dataDir}`, destination], env);
  } finally {
    if (previousApp && !installed && destination) {
      // Leave the backup available if restoration itself fails.
      await NodeFSP.rename(previousApp, destination);
    }
    await NodeFSP.rm(stage, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--worker")) return installDesktop();

  const logDir = NodePath.join(repoRoot, ".logs");
  await NodeFSP.mkdir(logDir, { recursive: true });
  const logPath = NodePath.join(logDir, `install-desktop-macos-${process.pid}.log`);
  const log = await NodeFSP.open(logPath, "w", 0o600);
  // The installer must survive quitting the app that owns this action's terminal.
  const worker = NodeChildProcess.spawn(process.execPath, [import.meta.filename, "--worker"], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  const completion = new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Installation failed (${signal ?? code}). See ${logPath}`));
    });
  });
  await log.close();
  console.log(`Build log: ${logPath}`);
  const tail = NodeChildProcess.spawn("tail", ["-n", "+1", "-f", logPath], { stdio: "inherit" });
  tail.on("error", () => console.log(`Follow the build in ${logPath}`));
  try {
    await completion;
    console.log("macOS app installed and opened.");
  } finally {
    tail.kill();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
