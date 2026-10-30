// @effect-diagnostics nodeBuiltinImport:off - Exercises the real inherited descriptor lifecycle in a subprocess.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

import { expect, it } from "vite-plus/test";

it("receives desktop messages and exits while the parent keeps both input pipes open", async () => {
  const child = NodeChildProcess.spawn(
    process.execPath,
    [NodeURL.fileURLToPath(new URL("./testing/DesktopPipeLifecycle.fixture.ts", import.meta.url))],
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"] },
  );
  // A failed exit must not leave a test process running. This never fires on success.
  // @effect-diagnostics-next-line globalTimers:off -- Bounds the native subprocess on failure; success waits for process exit.
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 8_000);
  let output = "";
  let errors = "";
  let verified = false;
  let activityVerified = false;
  let activityCount = 0;
  let cancelledRequestId: string | undefined;
  let controlOutput = "";
  const control = child.stdio[4];
  control?.on("data", (chunk: Buffer) => {
    controlOutput += chunk.toString();
    let end: number;
    while ((end = controlOutput.indexOf("\n")) >= 0) {
      const command = JSON.parse(controlOutput.slice(0, end)) as {
        type: string;
        requestId: string;
        active: boolean;
      };
      controlOutput = controlOutput.slice(end + 1);
      if (command.type !== "activity") continue;
      activityCount++;
      if (activityCount === 1) {
        // An unrelated acknowledgement must not complete this request.
        write(3, { type: "activity", ...key, requestId: "unrelated", ok: false });
        write(3, { type: "activity", ...key, requestId: command.requestId, ok: true });
      } else if (activityCount === 2) {
        write(3, { type: "activity", ...key, requestId: command.requestId, ok: false });
      } else if (activityCount === 3) {
        cancelledRequestId = command.requestId;
        write(3, { type: "attached", ...key, tabId: "cancel-barrier" });
      } else if (activityCount === 5) {
        write(3, { type: "attached", ...key, tabId: "timeout-barrier" });
      } else {
        // The cancelled request's late failure cannot reject the next change.
        write(3, { type: "activity", ...key, requestId: cancelledRequestId, ok: false });
        write(3, { type: "activity", ...key, requestId: command.requestId, ok: true });
      }
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const write = (fd: number, value: Record<string, unknown>) => {
    const stream = child.stdio[fd];
    if (!stream || !("write" in stream)) throw new Error(`Missing pipe ${fd}`);
    stream.write(`${JSON.stringify(value)}\n`);
  };
  const key = { threadId: "thread-1", tabId: "tab-1" };
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    let end: number;
    while ((end = output.indexOf("\n")) >= 0) {
      const line = output.slice(0, end);
      output = output.slice(end + 1);
      if (line === "ready") {
        write(3, { type: "attached", ...key });
        write(5, { version: 1, type: "desktopTelemetryHello", electronPid: process.pid });
      } else if (line === "attached") {
        write(3, { type: "detached", ...key });
      } else if (line === "activity-verified") {
        activityVerified = true;
      } else if (line === "verified") {
        verified = true;
      }
    }
  });
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    expect(errors).not.toContain("Error");
    expect(verified).toBe(true);
    expect(activityVerified).toBe(true);
    expect(activityCount).toBe(6);
    expect(result).toEqual({ code: 0, signal: null });
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    for (const stream of child.stdio) stream?.destroy();
  }
});
