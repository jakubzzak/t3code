import type { LinearDesktopResult } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { SettingsRow } from "../settings/settingsLayout";

export function LinearConnectionSettings({
  workspace,
  connectionKey,
}: {
  workspace: string;
  connectionKey: string | null;
}) {
  const [status, setStatus] = useState<LinearDesktopResult | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = window.desktopBridge?.linearRequest;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the Linear connection status from the desktop bridge, ignoring replies after the workspace changes
  useEffect(() => {
    let current = true;
    if (!request || !workspace || !connectionKey) return;
    void request({ operation: "status", workspace, connectionKey }).then(
      (result) => {
        if (current) setStatus(result);
      },
      (cause) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Unable to read the Linear connection.",
          );
      },
    );
    return () => {
      current = false;
    };
  }, [request, workspace, connectionKey]);
  const run = async (operation: "connect" | "disconnect" | "cancel") => {
    if (!request || !connectionKey) return;
    if (operation !== "cancel") setBusy(operation);
    setError(null);
    await Promise.resolve()
      .then(() => request({ operation, workspace, connectionKey }))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Linear connection failed.");
      });
    if (operation === "cancel") return;
    setBusy(null);
    await Promise.resolve()
      .then(() => request({ operation: "status", workspace, connectionKey }))
      .then(setStatus, () => {
        /* Keep the original failure visible. */
      });
  };
  return (
    <SettingsRow
      id="linear-api-connection"
      title="Issue connection"
      description={
        !request
          ? "Update the desktop app to connect Linear."
          : !connectionKey
            ? "Choose one project checkout to connect your Linear account."
            : !workspace
              ? "Set this project's workspace first."
              : status?.connection
                ? `${status.connection.name} · ${status.connection.email} · ${status.connection.workspace}`
                : "Connect your account to choose assigned issues and search this workspace. The Linear panel signs in separately."
      }
      control={
        <div className="flex items-center gap-2">
          {busy === "connect" ? (
            <Button variant="outline" size="sm" onClick={() => void run("cancel")}>
              Cancel sign-in
            </Button>
          ) : busy === "disconnect" ? (
            <Button variant="outline" size="sm" disabled>
              Disconnecting…
            </Button>
          ) : (
            <>
              {status?.connection && (
                <Button variant="ghost" size="sm" onClick={() => void run("disconnect")}>
                  Disconnect
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!request || !workspace || !connectionKey || !status?.configured}
                onClick={() => void run("connect")}
              >
                {status?.connection ? "Reconnect" : "Connect Linear"}
              </Button>
            </>
          )}
        </div>
      }
    >
      {status?.configured === false && (
        <p role="alert" className="text-sm text-destructive">
          This desktop build needs a Linear OAuth application configured.
        </p>
      )}
      {busy === "connect" && (
        <p role="status" className="text-sm text-muted-foreground">
          Complete authorization in your browser.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </SettingsRow>
  );
}
