import { useCallback, useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, LinearDesktopResult } from "@t3tools/contracts";
import { inboxEnvironment } from "~/state/inbox";
import { useAtomCommand } from "~/state/use-atom-command";
import { ensureLocalApi } from "~/localApi";
import { Button } from "../ui/button";
import { SettingsRow } from "../settings/settingsLayout";
import { requestLinear } from "./requestLinear";
export function EnvironmentLinearSettings({
  environmentId,
  projectId,
  workspace,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  workspace: string;
}) {
  const connectionKey = JSON.stringify([environmentId, projectId]);
  const [status, setStatus] = useState<LinearDesktopResult | null>(null);
  const [legacy, setLegacy] = useState<LinearDesktopResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const canWrite = useAtomValue(inboxEnvironment.linearBegin.permissionAtom(environmentId));
  const begin = useAtomCommand(inboxEnvironment.linearBegin);
  const cancel = useAtomCommand(inboxEnvironment.linearCancel);
  const disconnect = useAtomCommand(inboxEnvironment.linearDisconnect);
  const prepare = useAtomCommand(inboxEnvironment.linearPrepareMigration);
  const importConnection = useAtomCommand(inboxEnvironment.linearImportMigration);
  const refresh = useCallback(async () => {
    if (!workspace) return;
    try {
      const next = await requestLinear({ operation: "status", workspace, connectionKey });
      setStatus(next);
      setError(null);
      if (next.connection) setUrl(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read Linear connection.");
    }
  }, [workspace, connectionKey]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    let active = true;
    if (workspace && window.desktopBridge?.linearRequest)
      void window.desktopBridge
        .linearRequest({ operation: "status", workspace, connectionKey })
        .then(
          (value) => {
            if (active) setLegacy(value);
          },
          () => {},
        );
    return () => {
      active = false;
    };
  }, [workspace, connectionKey]);
  async function connect() {
    const popup = !window.desktopBridge ? window.open("", "_blank") : null;
    if (popup) popup.opener = null;
    setPending(true);
    try {
      const result = await begin({ environmentId, input: { projectId } });
      if (result._tag !== "Success") {
        popup?.close();
        return;
      }
      setUrl(result.value);
      if (popup) popup.location.href = result.value;
      else await ensureLocalApi().shell.openExternal(result.value);
    } catch {
      setError("Open the sign-in link to finish connecting Linear.");
    } finally {
      setPending(false);
    }
  }
  async function migrate() {
    if (!window.desktopBridge?.linearRequest) return;
    setPending(true);
    setError(null);
    try {
      const ticket = await prepare({ environmentId, input: { projectId } });
      if (ticket._tag !== "Success") return;
      const exported = await window.desktopBridge.linearRequest({
        operation: "export",
        workspace,
        connectionKey,
        migrationPublicKey: ticket.value.publicKey,
      });
      if (!exported.migration)
        throw new Error("Update the desktop app to migrate its existing connection.");
      await importConnection({
        environmentId,
        input: { projectId, ticket: ticket.value.ticket, envelope: exported.migration },
      });
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Linear migration failed. The original connection remains on this desktop.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <SettingsRow
      title="Connection"
      description={
        status?.connection
          ? `${status.connection.name} · ${status.connection.email} · ${status.connection.workspace}`
          : "One connection for this project's Linear view and Inbox, available from every connected client. The embedded Linear website signs in separately."
      }
      control={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {legacy?.connection && !status?.connection && (
            <Button size="sm" disabled={!canWrite || pending} onClick={() => void migrate()}>
              Move existing connection to environment
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!canWrite || pending || !workspace || !status?.configured}
            onClick={() => void connect()}
          >
            {status?.connection ? "Reconnect" : "Connect Linear"}
          </Button>
          {status?.connection && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!canWrite || pending}
              onClick={() => void disconnect({ environmentId, input: { projectId } }).then(refresh)}
            >
              Disconnect
            </Button>
          )}
          {url && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!canWrite || pending}
              onClick={() =>
                void cancel({ environmentId, input: { projectId } }).then(() => {
                  setUrl(null);
                  void refresh();
                })
              }
            >
              Cancel sign-in
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-2">
        {!workspace && (
          <p className="text-xs text-muted-foreground">Set this project's workspace first.</p>
        )}
        {workspace && status?.configured === false && (
          <p className="text-xs text-muted-foreground">
            Configure the environment's Linear OAuth application, or migrate this desktop's existing
            connection.
          </p>
        )}
        {url && (
          <p className="text-xs text-muted-foreground">
            Complete authorization in your browser.{" "}
            <a href={url} target="_blank" rel="noreferrer" className="underline">
              Open sign-in
            </a>
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </SettingsRow>
  );
}
