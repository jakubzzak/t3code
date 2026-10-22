import { LINEAR_INBOX_CATEGORIES } from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
import { useEffect, useState } from "react";
import { ensureLocalApi } from "~/localApi";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, InboxSourceConnection } from "@t3tools/contracts";
import { useServerConfigs } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { inboxEnvironment } from "~/state/inbox";
import { useAtomCommand } from "~/state/use-atom-command";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { OAuthClientIdSetting } from "./OAuthClientIdSetting";
import { useScopedSettings } from "../settings/useScopedSettings";
import { InboxSourceLogo } from "./InboxSourceLogo";
function SlackConnection({
  environmentId,
  connection,
  refresh,
}: {
  environmentId: EnvironmentId;
  connection: InboxSourceConnection;
  refresh: () => void;
}) {
  const [token, setToken] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const clientId = useScopedSettings((settings) => settings.slackClientId);
  const begin = useAtomCommand(inboxEnvironment.beginSlack, { reportFailure: true });
  const cancel = useAtomCommand(inboxEnvironment.cancelSlack, { reportFailure: true });
  const [lookback, setLookback] = useState(connection.initialLookbackDays);
  const [categories, setCategories] = useState<ReadonlyArray<string>>(connection.categories);
  const [pending, setPending] = useState(false);
  const canWrite = useAtomValue(inboxEnvironment.configureSource.permissionAtom(environmentId));
  const configure = useAtomCommand(inboxEnvironment.configureSource, { reportFailure: true });
  const disconnect = useAtomCommand(inboxEnvironment.disconnectSource, { reportFailure: true });
  const sync = useAtomCommand(inboxEnvironment.refreshSource, { reportFailure: true });
  const canSync = useAtomValue(inboxEnvironment.refreshSource.permissionAtom(environmentId));
  async function save(enabled = true) {
    setPending(true);
    try {
      const result = await configure({
        environmentId,
        input: {
          projectId: connection.projectId,
          source: "slack",
          enabled,
          initialLookbackDays: lookback,
          categories,
          ...(token ? { token: Redacted.make(token) } : {}),
        },
      });
      if (result._tag === "Success") {
        setToken("");
        refresh();
      }
    } finally {
      setPending(false);
    }
  }
  async function connect() {
    const popup = !window.desktopBridge ? window.open("", "_blank") : null;
    if (popup) popup.opener = null;
    setPending(true);
    try {
      const result = await begin({ environmentId, input: { projectId: connection.projectId } });
      if (result._tag !== "Success") {
        popup?.close();
        return;
      }
      setAuthorizationUrl(result.value);
      if (popup) popup.location.href = result.value;
      else await ensureLocalApi().shell.openExternal(result.value);
    } catch {
      popup?.close();
    } finally {
      setPending(false);
    }
  }
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <InboxSourceLogo source="slack" />
          Slack notifications
        </span>
      }
      description="Connect your Slack account for this project. DMs and mentions are read-only; Saved and To-dos have no supported API."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canWrite || pending || !clientId}
            onClick={() => void connect()}
          >
            {connection.connected ? "Reconnect Slack" : "Connect Slack"}
          </Button>
          {authorizationUrl && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!canWrite || pending}
              onClick={() =>
                void cancel({ environmentId, input: { projectId: connection.projectId } }).then(
                  () => setAuthorizationUrl(null),
                )
              }
            >
              Cancel sign-in
            </Button>
          )}
        </div>
        {connection.connected && (
          <p className="text-xs text-muted-foreground">
            Connected{connection.account ? ` · ${connection.account}` : ""}
          </p>
        )}
        {authorizationUrl && (
          <p className="text-xs text-muted-foreground">
            Complete authorization in your browser.{" "}
            <a href={authorizationUrl} target="_blank" rel="noreferrer" className="underline">
              Open sign-in
            </a>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Enable PKCE and register this environment's /oauth/inbox/slack/callback URL in your Slack
          app.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          {[
            ["dms", "Direct messages"],
            ["mentions", "Personal mentions"],
            ["group-mentions", "Group mentions"],
            ["saved", "Saved · unavailable"],
            ["todos", "To-dos · unavailable"],
          ].map(([id, label]) => (
            <label key={id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={categories.includes(id!)}
                disabled={!canWrite || id === "saved" || id === "todos" || pending}
                onChange={(event) =>
                  setCategories((current) =>
                    event.target.checked
                      ? [...current, id!]
                      : current.filter((value) => value !== id),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
        <label className="block space-y-1 text-xs">
          Initial history (days)
          <Input
            type="number"
            aria-label="Slack initial history days"
            min={1}
            max={90}
            value={lookback}
            disabled={!canWrite || pending}
            onChange={(event) => setLookback(Number(event.target.value))}
          />
        </label>
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Enter an existing user token manually
          </summary>
          <Input
            type="password"
            autoComplete="off"
            aria-label="Slack user OAuth token"
            placeholder={
              connection.connected
                ? "Replace connection token (optional)"
                : "Slack user OAuth token (xoxp-…)"
            }
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={!canWrite || pending}
          />
        </details>
        <p className="text-xs text-muted-foreground">
          Required read scopes: im:read, im:history, mpim:read, mpim:history, search:read,
          usergroups:read, channels:history and groups:history for thread context. Credentials stay
          on this environment.
        </p>
        {connection.error && (
          <p role="alert" className="text-xs text-destructive">
            {connection.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={
              !canWrite ||
              pending ||
              lookback < 1 ||
              lookback > 90 ||
              !Number.isInteger(lookback) ||
              !categories.length ||
              (!connection.connected && !token)
            }
            onClick={() => void save()}
          >
            Save selection
          </Button>
          {connection.connected && (
            <>
              <Switch
                aria-label="Enable Slack notifications"
                checked={connection.enabled}
                disabled={!canWrite || pending}
                onCheckedChange={(enabled) => void save(enabled)}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={!canSync || pending || !connection.enabled}
                onClick={() =>
                  void sync({
                    environmentId,
                    input: { projectId: connection.projectId, source: "slack" },
                  }).then(refresh)
                }
              >
                Refresh
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canWrite || pending}
                onClick={() =>
                  void disconnect({
                    environmentId,
                    input: { projectId: connection.projectId, source: "slack" },
                  }).then(refresh)
                }
              >
                Disconnect
              </Button>
            </>
          )}
        </div>
        {connection.lastSyncAt && (
          <p className="text-xs text-muted-foreground">
            Last synced {new Date(connection.lastSyncAt).toLocaleString()}
          </p>
        )}
      </div>
    </SettingsRow>
  );
}
function SuperhumanConnection({
  environmentId,
  connection,
  refresh,
}: {
  environmentId: EnvironmentId;
  connection: InboxSourceConnection;
  refresh: () => void;
}) {
  const [accounts, setAccounts] = useState<ReadonlyArray<string>>(connection.accounts);
  const [categories, setCategories] = useState<ReadonlyArray<string>>(connection.categories);
  const [pending, setPending] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const canWrite = useAtomValue(inboxEnvironment.configureSource.permissionAtom(environmentId));
  const begin = useAtomCommand(inboxEnvironment.beginSuperhuman, { reportFailure: true });
  const configure = useAtomCommand(inboxEnvironment.configureSource, { reportFailure: true });
  const disconnect = useAtomCommand(inboxEnvironment.disconnectSource, { reportFailure: true });
  const catalog = useEnvironmentQuery(
    connection.connected
      ? inboxEnvironment.superhumanCatalog({
          environmentId,
          input: { projectId: connection.projectId },
        })
      : null,
  );
  const filters = [
    ...new Set([
      ...(catalog.data?.splits ?? [])
        .filter((entry) => accounts.includes(entry.accountEmail))
        .map((entry) => `split:${entry.name}`),
      ...(catalog.data?.labels ?? [])
        .filter((entry) => accounts.includes(entry.accountEmail))
        .map((entry) => `label:${entry.name}`),
    ]),
  ];
  async function connect() {
    const popup = !window.desktopBridge ? window.open("", "_blank") : null;
    if (popup) popup.opener = null;
    setPending(true);
    try {
      const result = await begin({ environmentId, input: { projectId: connection.projectId } });
      if (result._tag !== "Success") {
        popup?.close();
        return;
      }
      setAuthorizationUrl(result.value);
      if (popup) popup.location.href = result.value;
      else await ensureLocalApi().shell.openExternal(result.value);
    } finally {
      setPending(false);
    }
  }
  async function save(enabled: boolean) {
    setPending(true);
    try {
      await configure({
        environmentId,
        input: {
          projectId: connection.projectId,
          source: "superhuman",
          enabled,
          accounts,
          categories,
        },
      });
      refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <InboxSourceLogo source="superhuman" />
          Superhuman notifications
        </span>
      }
      description="Sign in with Superhuman; its OAuth client is registered automatically, with no client ID or secret to enter. Requires Superhuman Mail MCP access and its Chrome extension for sign-in."
    >
      <div className="space-y-3">
        {!connection.connected ? (
          <>
            <Button size="sm" disabled={!canWrite || pending} onClick={() => void connect()}>
              Connect Superhuman
            </Button>
            {authorizationUrl && (
              <p className="text-xs text-muted-foreground">
                Complete sign-in in your browser.{" "}
                <a href={authorizationUrl} target="_blank" rel="noreferrer" className="underline">
                  Open sign-in
                </a>{" "}
                <button type="button" className="underline" onClick={refresh}>
                  Refresh connection
                </button>
              </p>
            )}
          </>
        ) : (
          <>
            <fieldset className="space-y-1 text-xs">
              <legend className="mb-1 font-medium">Accounts</legend>
              {catalog.data?.accounts.map((account) => (
                <label key={account} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canWrite || pending}
                    checked={accounts.includes(account)}
                    onChange={(event) =>
                      setAccounts((current) =>
                        event.target.checked
                          ? [...current, account]
                          : current.filter((value) => value !== account),
                      )
                    }
                  />
                  {account}
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-1 text-xs">
              <legend className="mb-1 font-medium">Splits and labels</legend>
              {filters.map((category) => (
                <label key={category} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canWrite || pending}
                    checked={categories.includes(category)}
                    onChange={(event) =>
                      setCategories((current) =>
                        event.target.checked
                          ? [...current, category]
                          : current.filter((value) => value !== category),
                      )
                    }
                  />
                  {category.replace("split:", "Split · ").replace("label:", "Label · ")}
                </label>
              ))}
            </fieldset>
            {catalog.error && (
              <p role="alert" className="text-xs text-destructive">
                {catalog.error}
                <button className="ml-1 underline" onClick={catalog.refresh}>
                  Retry
                </button>
              </p>
            )}
            {connection.error && (
              <p role="alert" className="text-xs text-destructive">
                {connection.error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!canWrite || pending || !accounts.length || !categories.length}
                onClick={() => void save(true)}
              >
                Save selection
              </Button>
              <Switch
                aria-label="Enable Superhuman notifications"
                checked={connection.enabled}
                disabled={!canWrite || pending || !accounts.length || !categories.length}
                onCheckedChange={(enabled) => void save(enabled)}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={!canWrite || pending}
                onClick={() =>
                  void disconnect({
                    environmentId,
                    input: { projectId: connection.projectId, source: "superhuman" },
                  }).then(refresh)
                }
              >
                Disconnect
              </Button>
            </div>
          </>
        )}
      </div>
    </SettingsRow>
  );
}
function LinearNotifications({
  environmentId,
  connection,
  refresh,
}: {
  environmentId: EnvironmentId;
  connection: InboxSourceConnection;
  refresh: () => void;
}) {
  const [categories, setCategories] = useState<ReadonlyArray<string>>(connection.categories);
  const canWrite = useAtomValue(inboxEnvironment.configureSource.permissionAtom(environmentId));
  const configure = useAtomCommand(inboxEnvironment.configureSource);
  const [pending, setPending] = useState(false);
  async function save(enabled: boolean) {
    setPending(true);
    try {
      await configure({
        environmentId,
        input: { projectId: connection.projectId, source: "linear", enabled, categories },
      });
      refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <InboxSourceLogo source="linear" />
          Linear notifications
        </span>
      }
      description={
        connection.connected
          ? "Include the full notification center, or select categories. Linear view is enabled separately in Features."
          : "Connect or migrate Linear above before enabling its notifications."
      }
    >
      <div className="space-y-3">
        <fieldset className="flex flex-wrap gap-3 text-xs">
          <legend className="sr-only">Linear notification categories</legend>
          {["all", ...LINEAR_INBOX_CATEGORIES].map((category) => (
            <label key={category} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={categories.includes(category)}
                disabled={
                  !canWrite ||
                  pending ||
                  !connection.connected ||
                  (category !== "all" && categories.includes("all"))
                }
                onChange={(event) =>
                  setCategories((current) =>
                    category === "all"
                      ? event.target.checked
                        ? ["all"]
                        : []
                      : event.target.checked
                        ? [...current, category]
                        : current.filter((value) => value !== category),
                  )
                }
              />
              {category === "all"
                ? "Everything"
                : category
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (letter) => letter.toUpperCase())}
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!canWrite || pending || !connection.connected || !categories.length}
            onClick={() => void save(true)}
          >
            Save selection
          </Button>
          <Switch
            aria-label="Enable Linear notifications"
            checked={connection.enabled}
            disabled={!canWrite || pending || !connection.connected || !categories.length}
            onCheckedChange={(enabled) => void save(enabled)}
          />
        </div>
        {connection.error && (
          <p role="alert" className="text-xs text-destructive">
            {connection.error}
          </p>
        )}
      </div>
    </SettingsRow>
  );
}
function ProjectSources({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const result = useEnvironmentQuery(
    inboxEnvironment.sources({ environmentId, input: { projectId } }),
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") result.refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [result.refresh]);
  const superhuman = result.data?.find((connection) => connection.source === "superhuman");
  const linear = result.data?.find((connection) => connection.source === "linear");
  const slack = result.data?.find((connection) => connection.source === "slack");
  return (
    <>
      {result.error && (
        <p role="alert" className="text-xs text-destructive">
          {result.error}
        </p>
      )}
      {slack && (
        <SlackConnection
          key={`slack:${slack.connected}`}
          environmentId={environmentId}
          connection={slack}
          refresh={result.refresh}
        />
      )}
      {linear && (
        <LinearNotifications
          key={`linear:${linear.connected}`}
          environmentId={environmentId}
          connection={linear}
          refresh={result.refresh}
        />
      )}
      {superhuman && (
        <SuperhumanConnection
          key={`superhuman:${superhuman.connected}`}
          environmentId={environmentId}
          connection={superhuman}
          refresh={result.refresh}
        />
      )}
    </>
  );
}
export function InboxIntegrationSettings() {
  const { scope } = useSettingsScope();
  const configs = useServerConfigs();
  const members = scope.kind === "project" || scope.kind === "checkout" ? scope.members : [];
  return (
    <SettingsSection title="Inbox sources">
      <p className="text-xs text-muted-foreground">
        {members.length
          ? "Each project has its own connections and relevance filters. Enable Inbox in Features to begin syncing."
          : "Select a project above to configure its notification sources."}
      </p>
      {members.length > 0 && <OAuthClientIdSetting source="slack" />}
      {members.map((member) =>
        configs.get(member.environmentId)?.notificationInbox ? (
          <ProjectSources
            key={member.physicalProjectKey}
            environmentId={member.environmentId}
            projectId={member.id}
          />
        ) : (
          <p key={member.physicalProjectKey} className="text-xs text-muted-foreground">
            Update this environment to configure Inbox sources.
          </p>
        ),
      )}
    </SettingsSection>
  );
}
