import type { DesktopTerminalCommandState } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Installs a command on this desktop, independent of the selected environment. */
export function TerminalCommandSettings() {
  const bridge = window.desktopBridge?.terminalCommand;
  const [state, setState] = useState<DesktopTerminalCommandState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the desktop bridge's terminal command state, ignoring the reply after unmount
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge.get().then(
      (value) => {
        if (active) setState(value);
      },
      (cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Could not check the terminal command.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, [bridge]);

  if (!bridge) return null;
  const run = async (action: "get" | "install" | "remove") => {
    setBusy(true);
    setError(null);
    const next = await Promise.resolve()
      .then(() => bridge[action]())
      .then(
        (value) => ({ value }),
        (cause: unknown) => {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not update the terminal command. Try again.",
          );
          return null;
        },
      );
    if (next) setState(next.value);
    setBusy(false);
  };

  return (
    <SettingsSection id="terminal" title="Terminal">
      <SettingsRow
        {...searchableSetting("terminal-command")}
        description="Run t3 . in a terminal to open a project with a fresh chat, even when the desktop app is closed."
        control={
          state?.installed ? (
            <Button variant="outline" disabled={busy} onClick={() => void run("remove")}>
              Remove command
            </Button>
          ) : state?.status === "not-installed" ? (
            <Button variant="outline" disabled={busy} onClick={() => void run("install")}>
              Install t3 command
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={busy || (!state && !error)}
              onClick={() => void run("get")}
            >
              Check again
            </Button>
          )
        }
      >
        <div className="space-y-2 text-muted-foreground text-sm" aria-live="polite">
          {busy ? <p>Updating terminal command…</p> : null}
          {!state && !error ? <p>Checking terminal command…</p> : null}
          {state?.status === "conflict" ? (
            <p>
              An existing command was found at <code>{state.conflictingPath}</code>. Update or
              remove that installation yourself, then check again. Blackbird will leave it
              unchanged.
            </p>
          ) : null}
          {state?.installed ? (
            <p>
              Installed at <code>{state.path}</code>.{" "}
              {state.onPath ? (
                "Open a new terminal and run t3 . in your project."
              ) : (
                <>
                  Add <code>{state.directory}</code> to your shell’s PATH, then open a new terminal
                  and run <code>t3 .</code>.
                </>
              )}
            </p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
