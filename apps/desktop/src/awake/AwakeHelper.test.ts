// @effect-diagnostics nodeBuiltinImport:off -- Executes the actual shell helper with isolated files and a fake pmset; never installs it or changes OS settings.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { installAwakeCommand, removeAwakeCommand, shellQuote } from "./AwakeInstallation.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});
const token = "a".repeat(32);
function fixture(initial = { sleep: 0, battery: 0, ac: 1, ups: 2 }, omitDefaultSleep = false) {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "awake test '"));
  dirs.push(dir);
  const root = NodePath.join(dir, "root");
  NodeFS.mkdirSync(root);
  const helper = NodePath.join(dir, "helper");
  const pmset = NodePath.join(dir, "pmset");
  const state = NodePath.join(dir, "power.json");
  const calls = NodePath.join(dir, "calls");
  const failure = NodePath.join(dir, "fail");
  NodeFS.writeFileSync(state, JSON.stringify(initial));
  NodeFS.writeFileSync(
    pmset,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(`${pmset}.cjs`)} "$@"\n`,
    { mode: 0o755 },
  );
  NodeFS.writeFileSync(
    `${pmset}.cjs`,
    `
const fs = require('node:fs');
const path = ${JSON.stringify(state)}, calls = ${JSON.stringify(calls)}, failure = ${JSON.stringify(failure)};
const args = process.argv.slice(2), power = JSON.parse(fs.readFileSync(path));
if (args[0] === '-g') {
  console.log(args[1] === 'custom' ? 'Battery Power:\\n lowpowermode '+power.battery+'\\nAC Power:\\n lowpowermode '+power.ac+'\\nUPS Power:\\n lowpowermode '+power.ups : 'System-wide power settings:'+(${omitDefaultSleep} && power.sleep === 0 ? '' : '\\n SleepDisabled '+power.sleep));
} else {
  fs.appendFileSync(calls, args.join(' ')+'\\n');
  if (fs.existsSync(failure) && fs.readFileSync(failure, 'utf8') === args.join(' ')) process.exit(1);
  power[args[1] === 'disablesleep' ? 'sleep' : {'-b':'battery','-c':'ac','-u':'ups'}[args[0]]] = Number(args[2]);
  fs.writeFileSync(path, JSON.stringify(power));
}
`,
  );
  const source = NodeFS.readFileSync(
    new URL("../../resources/awake/helper.sh", import.meta.url),
    "utf8",
  )
    .replace("ROOT=/var/db/com.blackbird.keep-awake-v1", `ROOT=${shellQuote(root)}`)
    .replace(
      "HELPER=/Library/PrivilegedHelperTools/com.blackbird.keep-awake-v1",
      `HELPER=${shellQuote(helper)}`,
    )
    .replace("PMSET=/usr/bin/pmset", `PMSET=${shellQuote(pmset)}`)
    .replace(
      '[ "$(/usr/bin/id -u)" = 0 ] || fail "Keep awake requires its installed helper."',
      ": # Isolated non-root fixture",
    );
  NodeFS.writeFileSync(helper, source, { mode: 0o755 });
  return {
    root,
    state,
    failure,
    run: (args: string[], daemon = false) => {
      const env = { ...process.env };
      delete env.SUDO_UID;
      if (!daemon) env.SUDO_UID = String(process.getuid?.());
      return NodeChildProcess.spawnSync(helper, args, { encoding: "utf8", env });
    },
    power: () => JSON.parse(NodeFS.readFileSync(state, "utf8")),
    journal: () => NodeFS.existsSync(NodePath.join(root, "session")),
    calls: () => (NodeFS.existsSync(calls) ? NodeFS.readFileSync(calls, "utf8") : ""),
    expire: () => {
      const file = NodePath.join(root, "session");
      const fields = NodeFS.readFileSync(file, "utf8").trim().split(" ");
      fields[3] = "1";
      NodeFS.writeFileSync(file, fields.join(" ") + "\n");
    },
  };
}

// oxlint-disable-next-line t3code/no-global-process-runtime -- Test collection checks the host before executing macOS-native helper commands.
describe.skipIf(NodeOS.platform() !== "darwin")("macOS recovery helper", () => {
  it("restores distinct power profiles and keeps a fresh session alive", () => {
    const f = fixture();
    expect(f.run(["apply", token, String(process.pid), "1"]).status).toBe(0);
    expect(f.power()).toEqual({ sleep: 1, battery: 1, ac: 1, ups: 1 });
    expect(f.run(["recover"], true).status).toBe(0);
    expect(f.journal()).toBe(true);
    expect(f.run(["release", token]).status).toBe(0);
    expect(f.power()).toEqual({ sleep: 0, battery: 0, ac: 1, ups: 2 });
    expect(f.journal()).toBe(false);
  });
  it("handles macOS omitting the default SleepDisabled value", () => {
    const f = fixture(undefined, true);
    expect(f.run(["apply", token, String(process.pid), "0"]).status).toBe(0);
    expect(f.power().sleep).toBe(1);
    expect(f.run(["release", token]).status).toBe(0);
    expect(f.power().sleep).toBe(0);
  });
  it("does not duplicate changes on a heartbeat", () => {
    const f = fixture();
    expect(f.run(["apply", token, String(process.pid), "1"]).status).toBe(0);
    const calls = f.calls();
    expect(f.run(["apply", token, String(process.pid), "1"]).status).toBe(0);
    expect(f.calls()).toBe(calls);
  });
  it("recovers expired sessions without an app or logged-in user", () => {
    const f = fixture();
    expect(f.run(["apply", token, String(process.pid), "1"]).status).toBe(0);
    f.expire();
    expect(f.run(["recover"], true).status).toBe(0);
    expect(f.power()).toEqual({ sleep: 0, battery: 0, ac: 1, ups: 2 });
    expect(f.journal()).toBe(false);
  });
  it("retains the journal until a failed restoration succeeds", () => {
    const f = fixture();
    expect(f.run(["apply", token, String(process.pid), "1"]).status).toBe(0);
    f.expire();
    NodeFS.writeFileSync(f.failure, "-a disablesleep 0");
    expect(f.run(["recover"], true).status).not.toBe(0);
    expect(f.journal()).toBe(true);
    NodeFS.rmSync(f.failure);
    expect(f.run(["recover"], true).status).toBe(0);
    expect(f.journal()).toBe(false);
    expect(f.power().sleep).toBe(0);
  });
  it("never changes power policy if journaling fails", () => {
    const f = fixture();
    NodeFS.mkdirSync(NodePath.join(f.root, "session.next"));
    expect(f.run(["apply", token, String(process.pid), "1"]).status).not.toBe(0);
    expect(f.calls()).toBe("");
  });
  it("recovers a partially applied policy", () => {
    const f = fixture();
    NodeFS.writeFileSync(f.failure, "-c lowpowermode 1");
    expect(f.run(["apply", token, String(process.pid), "1"]).status).not.toBe(0);
    expect(f.journal()).toBe(true);
    expect(f.run(["release", token]).status).toBe(0);
    expect(f.power()).toEqual({ sleep: 0, battery: 0, ac: 1, ups: 2 });
  });
  it("allows sleep even when restoring Low Power Mode fails", () => {
    const f = fixture();
    expect(f.run(["apply", token, String(process.pid), "1"]).status).toBe(0);
    NodeFS.writeFileSync(f.failure, "-b lowpowermode 0");
    expect(f.run(["release", token]).status).not.toBe(0);
    expect(f.power().sleep).toBe(0);
    expect(f.journal()).toBe(true);
    NodeFS.rmSync(f.failure);
    expect(f.run(["release", token]).status).toBe(0);
    expect(f.power()).toEqual({ sleep: 0, battery: 0, ac: 1, ups: 2 });
  });
  it("captures a new Low Power Mode baseline after a policy pause", () => {
    const f = fixture();
    expect(f.run(["apply", token, String(process.pid), "1"]).status).toBe(0);
    expect(f.run(["apply", token, String(process.pid), "0"]).status).toBe(0);
    NodeFS.writeFileSync(f.state, JSON.stringify({ sleep: 1, battery: 2, ac: 0, ups: 3 }));
    expect(f.run(["apply", token, String(process.pid), "1"]).status).toBe(0);
    expect(f.run(["release", token]).status).toBe(0);
    expect(f.power()).toEqual({ sleep: 0, battery: 2, ac: 0, ups: 3 });
  });
  it("preserves pre-existing sleep prevention and external changes", () => {
    const f = fixture({ sleep: 1, battery: 0, ac: 0, ups: 0 });
    expect(f.run(["apply", token, String(process.pid), "1"]).status).toBe(0);
    NodeFS.writeFileSync(f.state, JSON.stringify({ sleep: 1, battery: 2, ac: 1, ups: 1 }));
    expect(f.run(["release", token]).status).toBe(0);
    expect(f.power()).toEqual({ sleep: 1, battery: 2, ac: 0, ups: 0 });
  });
  it("rejects other instances and privileged verbs through sudo", () => {
    const f = fixture();
    expect(f.run(["apply", token, String(process.pid), "0"]).status).toBe(0);
    expect(f.run(["apply", "b".repeat(32), String(process.pid), "0"]).stderr).toContain(
      "Another Blackbird",
    );
    expect(f.run(["release", "b".repeat(32)]).status).not.toBe(0);
    expect(f.run(["uninstall"]).status).not.toBe(0);
    expect(f.run(["uninstall"], true).status).not.toBe(0);
    expect(f.run(["recover"]).status).not.toBe(0);
    expect(f.power().sleep).toBe(1);
  });
  it("rejects malformed journals without evaluating them", () => {
    const f = fixture();
    NodeFS.writeFileSync(NodePath.join(f.root, "session"), "$(touch /never-run-this)\n");
    expect(f.run(["recover"], true).status).not.toBe(0);
    expect(f.journal()).toBe(true);
    expect(f.calls()).toBe("");
  });
  it("rejects unsupported operations and malformed requests without changing power settings", () => {
    const f = fixture();
    for (const args of [
      ["status"],
      ["/bin/sh", "-c", "id"],
      ["apply", "not-a-token", String(process.pid), "0"],
      ["apply", token, "1", "0"],
      ["apply", token, String(process.pid), "2"],
      ["apply", token, String(process.pid), "0", "extra"],
      ["release", token, "extra"],
    ]) {
      expect(f.run(args).status, args.join(" ")).not.toBe(0);
    }
    expect(f.calls()).toBe("");
    expect(f.journal()).toBe(false);
  });
});

describe("Keep awake installer", () => {
  it("quotes helper contents and limits sudo to the helper's public verbs", () => {
    const command = installAwakeCommand("literal ' $HOME `id`\n", 501);
    expect(command).toContain(shellQuote("literal ' $HOME `id`\n"));
    expect(command).toContain("#501 ALL=(root) NOPASSWD:");
    expect(command).not.toContain("NOPASSWD: ALL");
    expect(() => installAwakeCommand("", NaN)).toThrow("Invalid desktop user ID");
  });
});

/** Runs generated installer commands with every system path redirected to a temp directory. */
function installerFixture() {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "awake-install-"));
  dirs.push(dir);
  const root = `${dir}/db/com.blackbird.keep-awake-v1`;
  const helper = `${dir}/helpers/com.blackbird.keep-awake-v1`;
  const plist = `${dir}/daemons/com.blackbird.keep-awake-v1.plist`;
  const sudoers = `${dir}/sudoers/blackbird-keep-awake-v1`;
  for (const subdir of ["db", "daemons", "sudoers"]) NodeFS.mkdirSync(`${dir}/${subdir}`);
  NodeFS.writeFileSync(
    `${dir}/launchctl`,
    `#!/bin/sh
case "$1" in
  bootstrap) [ ! -e '${dir}/fail' ] || exit 1; touch '${dir}/running';;
  print) test -e '${dir}/running';;
  bootout) test -e '${dir}/running' || exit 1; rm '${dir}/running';;
esac
`,
    { mode: 0o755 },
  );
  const run = (command: string) => {
    const isolated = command
      .replaceAll("/Library/PrivilegedHelperTools", `${dir}/helpers`)
      .replaceAll("/Library/LaunchDaemons", `${dir}/daemons`)
      .replaceAll("/etc/sudoers.d", `${dir}/sudoers`)
      .replaceAll("/var/db", `${dir}/db`)
      .replaceAll("/bin/launchctl", `${dir}/launchctl`)
      .replaceAll("/usr/bin/install -o root -g wheel", "/usr/bin/install");
    return NodeChildProcess.spawnSync("/bin/sh", ["-c", isolated], { encoding: "utf8" });
  };
  return { dir, root, helper, plist, sudoers, run };
}

// oxlint-disable-next-line t3code/no-global-process-runtime -- Test collection checks the host before executing macOS-native helper commands.
describe.skipIf(NodeOS.platform() !== "darwin")("installer rollback", () => {
  const source = "#!/bin/sh\n# Literal ' $HOME `id`\nexit 0\n";
  it("installs literal source with restricted permissions and removes an unloaded job", () => {
    const f = installerFixture();
    expect(f.run(installAwakeCommand(source, process.getuid!())).status).toBe(0);
    expect(NodeFS.readFileSync(f.helper, "utf8")).toBe(source);
    expect(NodeFS.statSync(f.sudoers).mode & 0o777).toBe(0o440);
    NodeFS.rmSync(`${f.dir}/running`);
    expect(f.run(removeAwakeCommand).status).toBe(0);
    for (const path of [f.root, f.helper, f.plist, f.sudoers])
      expect(NodeFS.existsSync(path)).toBe(false);
  });
  it("rolls back when recovery cannot start", () => {
    const f = installerFixture();
    NodeFS.writeFileSync(`${f.dir}/fail`, "");
    expect(f.run(installAwakeCommand(source, process.getuid!())).status).not.toBe(0);
    for (const path of [f.root, f.helper, f.plist, f.sudoers])
      expect(NodeFS.existsSync(path)).toBe(false);
  });
  it("preserves existing installations and can remove an incomplete setup", () => {
    const f = installerFixture();
    NodeFS.writeFileSync(f.plist, "existing");
    expect(f.run(installAwakeCommand(source, process.getuid!())).status).not.toBe(0);
    expect(NodeFS.readFileSync(f.plist, "utf8")).toBe("existing");
    expect(f.run(removeAwakeCommand).status).toBe(0);
    expect(NodeFS.existsSync(f.plist)).toBe(false);
  });
});
