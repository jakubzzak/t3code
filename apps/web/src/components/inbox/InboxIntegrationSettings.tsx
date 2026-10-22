import { ChevronDownIcon } from "lucide-react";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { LINEAR_INBOX_CATEGORIES } from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
import { useEffect, useState } from "react";
import { ensureLocalApi } from "~/localApi";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, InboxSource, InboxSourceConnection } from "@t3tools/contracts";
import { useServerConfigs } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { inboxEnvironment } from "~/state/inbox";
import { useAtomCommand } from "~/state/use-atom-command";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { LinearSettings } from "../settings/LinearSettings";
import { integrationDisabledReason } from "./integrationAvailability";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { OAuthClientIdSetting } from "./OAuthClientIdSetting";
import { useScopedSettings } from "../settings/useScopedSettings";
import { InboxSourceLogo } from "./InboxSourceLogo";
function IntegrationSelection({
  label,
  options,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  selected: ReadonlyArray<string>;
  disabled?: boolean;
  onToggle: (value: string, checked: boolean) => void;
}) {
  const chosen = options.filter((option) => selected.includes(option.value));
  const summary =
    chosen.length === 1
      ? chosen[0]!.label
      : chosen.length
        ? `${chosen.length} selected`
        : "Choose…";
  return (
    <div className="w-full sm:w-72">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !options.length}
              aria-label={label}
              className="w-full justify-between"
            />
          }
        >
          <span className="truncate">{summary}</span>
          <ChevronDownIcon className="size-3.5 shrink-0" />
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-72">
          <fieldset className="max-h-72 space-y-2 overflow-y-auto p-3 text-xs">
            <legend className="sr-only">{label}</legend>
            {options.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 has-disabled:text-muted-foreground"
              >
                <input
                  type="checkbox"
                  disabled={option.disabled}
                  checked={selected.includes(option.value)}
                  onChange={(event) => onToggle(option.value, event.target.checked)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        </PopoverPopup>
      </Popover>
    </div>
  );
}

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
    <>
      <SettingsRow
        title="Connection"
        description={
          connection.connected
            ? `Connected${connection.account ? ` · ${connection.account}` : ""}`
            : "Connect your Slack account for this project. Source messages stay read-only."
        }
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
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
            {connection.connected && (
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
            )}
          </div>
        }
      >
        {authorizationUrl && (
          <p className="mt-2 text-xs text-muted-foreground">
            Complete authorization in your browser.{" "}
            <a href={authorizationUrl} target="_blank" rel="noreferrer" className="underline">
              Open sign-in
            </a>
          </p>
        )}
        {connection.error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {connection.error}
          </p>
        )}
      </SettingsRow>
      <SettingsRow
        title="Notifications"
        description="Collect the selected Slack activity in this project's Inbox."
        control={
          <Switch
            aria-label="Enable Slack notifications"
            checked={connection.enabled}
            disabled={!canWrite || pending || !connection.connected}
            onCheckedChange={(enabled) => void save(enabled)}
          />
        }
      />
      <SettingsRow
        title="Notification categories"
        description="Choose relevant conversations. Saved and To-dos have no supported connector yet."
        control={
          <IntegrationSelection
            label="Slack notification categories"
            selected={categories}
            disabled={!canWrite || pending}
            options={[
              { value: "dms", label: "Direct messages" },
              { value: "mentions", label: "Personal mentions" },
              { value: "group-mentions", label: "Group mentions" },
              { value: "saved", label: "Saved · unavailable", disabled: true },
              { value: "todos", label: "To-dos · unavailable", disabled: true },
            ]}
            onToggle={(id, checked) =>
              setCategories((current) =>
                checked ? [...current, id] : current.filter((value) => value !== id),
              )
            }
          />
        }
      />
      <SettingsRow
        title="Initial history"
        description="How many days to collect when this connection starts (1–90)."
        control={
          <div className="w-full sm:w-72">
            <Input
              size="sm"
              type="number"
              aria-label="Slack initial history days"
              min={1}
              max={90}
              value={lookback}
              disabled={!canWrite || pending}
              onChange={(event) => setLookback(Number(event.target.value))}
            />
          </div>
        }
      />
      <SettingsRow
        title="Apply selection"
        description={
          connection.lastSyncAt
            ? `Last synced ${new Date(connection.lastSyncAt).toLocaleString()}`
            : "Save categories and history for this project."
        }
        control={
          <div className="flex items-center justify-end gap-2">
            {connection.connected && (
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
            )}
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
          </div>
        }
      />
      <details className="px-3 py-3 sm:px-4">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Advanced connection
        </summary>
        <div className="space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">
            Enable PKCE and register this environment's /oauth/inbox/slack/callback URL in your
            Slack app. You can also enter an existing user token, then save the selection above.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label htmlFor="slack-manual-token" className="text-xs">
              User OAuth token
            </label>
            <div className="w-full sm:w-72">
              <Input
                id="slack-manual-token"
                size="sm"
                type="password"
                autoComplete="off"
                aria-label="Slack user OAuth token"
                placeholder={connection.connected ? "Replace token (optional)" : "xoxp-…"}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={!canWrite || pending}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Required read scopes: im:read, im:history, mpim:read, mpim:history, search:read,
            usergroups:read, channels:history and groups:history for thread context. Credentials
            stay on this environment.
          </p>
        </div>
      </details>
    </>
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
    <>
      <SettingsRow
        title="Connection"
        description={
          connection.connected
            ? "Connected to Superhuman Mail for this project."
            : "OAuth setup is automatic. Superhuman Mail MCP access and its Chrome extension are required for sign-in."
        }
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canWrite || pending}
              onClick={() => void connect()}
            >
              {connection.connected ? "Reconnect Superhuman" : "Connect Superhuman"}
            </Button>
            {connection.connected && (
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
            )}
          </div>
        }
      >
        {authorizationUrl && (
          <p className="mt-2 text-xs text-muted-foreground">
            Complete sign-in in your browser.{" "}
            <a href={authorizationUrl} target="_blank" rel="noreferrer" className="underline">
              Open sign-in
            </a>{" "}
            ·{" "}
            <button type="button" className="underline" onClick={refresh}>
              Refresh connection
            </button>
          </p>
        )}
        {connection.error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {connection.error}
          </p>
        )}
      </SettingsRow>
      <SettingsRow
        title="Notifications"
        description="Collect selected splits and labels in this project's Inbox."
        control={
          <Switch
            aria-label="Enable Superhuman notifications"
            checked={connection.enabled}
            disabled={
              !canWrite ||
              pending ||
              !connection.connected ||
              !accounts.length ||
              !categories.length
            }
            onCheckedChange={(enabled) => void save(enabled)}
          />
        }
      />
      <SettingsRow
        title="Accounts"
        description={
          !connection.connected
            ? "Connect Superhuman to choose your email accounts."
            : "Choose accounts for this project."
        }
        control={
          <IntegrationSelection
            label="Superhuman accounts"
            selected={accounts}
            disabled={!canWrite || pending || !connection.connected}
            options={(catalog.data?.accounts ?? []).map((account) => ({
              value: account,
              label: account,
            }))}
            onToggle={(account, checked) =>
              setAccounts((current) =>
                checked ? [...current, account] : current.filter((value) => value !== account),
              )
            }
          />
        }
      />
      <SettingsRow
        title="Splits and labels"
        description={
          !connection.connected
            ? "Connect to choose Important and other email groups."
            : "Choose the email groups relevant to this project."
        }
        control={
          <IntegrationSelection
            label="Superhuman splits and labels"
            selected={categories}
            disabled={!canWrite || pending || !connection.connected}
            options={filters.map((category) => ({
              value: category,
              label: category.replace("split:", "Split · ").replace("label:", "Label · "),
            }))}
            onToggle={(category, checked) =>
              setCategories((current) =>
                checked ? [...current, category] : current.filter((value) => value !== category),
              )
            }
          />
        }
      >
        {catalog.error && (
          <p role="alert" className="pb-2 text-xs text-destructive">
            {catalog.error}{" "}
            <button type="button" className="underline" onClick={catalog.refresh}>
              Retry
            </button>
          </p>
        )}
      </SettingsRow>
      <SettingsRow
        title="Apply selection"
        description="Save accounts and filters for this project."
        control={
          <Button
            size="sm"
            disabled={
              !canWrite ||
              pending ||
              !connection.connected ||
              !accounts.length ||
              !categories.length
            }
            onClick={() => void save(true)}
          >
            Save selection
          </Button>
        }
      />
    </>
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
    <>
      <SettingsRow
        title="Notifications"
        description="Collect this account's Linear notification center in this project's Inbox."
        control={
          <Switch
            aria-label="Enable Linear notifications"
            checked={connection.enabled}
            disabled={!canWrite || pending || !connection.connected || !categories.length}
            onCheckedChange={(enabled) => void save(enabled)}
          />
        }
      />
      <SettingsRow
        title="Notification categories"
        description={
          connection.connected
            ? "Include everything, or select activity categories."
            : "Connect Linear above to choose categories."
        }
        control={
          <IntegrationSelection
            label="Linear notification categories"
            selected={categories}
            disabled={!canWrite || pending || !connection.connected}
            options={["all", ...LINEAR_INBOX_CATEGORIES].map((category) => ({
              value: category,
              label:
                category === "all"
                  ? "Everything"
                  : category
                      .replace(/([A-Z])/g, " $1")
                      .replace(/^./, (letter) => letter.toUpperCase()),
              disabled: category !== "all" && categories.includes("all"),
            }))}
            onToggle={(category, checked) =>
              setCategories((current) =>
                category === "all"
                  ? checked
                    ? ["all"]
                    : []
                  : checked
                    ? [...current, category]
                    : current.filter((value) => value !== category),
              )
            }
          />
        }
      />
      <SettingsRow
        title="Apply selection"
        description="Save notification categories for this project."
        control={
          <Button
            size="sm"
            disabled={!canWrite || pending || !connection.connected || !categories.length}
            onClick={() => void save(true)}
          >
            Save selection
          </Button>
        }
      />
      {connection.error && (
        <SettingsRow
          title="Connection issue"
          description={
            <span role="alert" className="text-destructive">
              {connection.error}
            </span>
          }
        />
      )}
    </>
  );
}

function InactiveSource({ source }: { source: InboxSource }) {
  const name = source === "linear" ? "Linear" : source === "slack" ? "Slack" : "Superhuman";
  return (
    <>
      {source !== "linear" && (
        <SettingsRow
          title="Connection"
          description={`Connect an account only for the selected project.`}
          control={
            <Button size="sm" variant="outline" disabled>
              Connect {name}
            </Button>
          }
        />
      )}
      <SettingsRow
        title="Notifications"
        description="Enable Inbox in this project’s Features to collect notifications."
        control={<Switch aria-label={`Enable ${name} notifications`} checked={false} disabled />}
      />
      {source === "slack" && (
        <>
          <SettingsRow
            title="Notification categories"
            description="Direct messages, personal mentions and group mentions. Saved and To-dos are unavailable."
          />
          <SettingsRow
            title="Initial history"
            description="Days of activity to collect when the connection starts."
            control={
              <div className="w-full sm:w-72">
                <Input
                  size="sm"
                  type="number"
                  aria-label="Slack initial history days"
                  value="7"
                  disabled
                />
              </div>
            }
          />
        </>
      )}
      {source === "linear" && (
        <SettingsRow
          title="Notification categories"
          description="The full notification center, or your selected activity categories."
        />
      )}
      {source === "superhuman" && (
        <>
          <SettingsRow
            title="Accounts"
            description="Select which email accounts belong to this project."
          />
          <SettingsRow
            title="Splits and labels"
            description="Important and other selected email groups."
          />
        </>
      )}
    </>
  );
}

export function ProjectIntegrationSettings() {
  const { scope } = useSettingsScope();
  const settings = useScopedSettings((settings) => settings);
  const configs = useServerConfigs();
  const selected = scope.kind === "project" || scope.kind === "checkout";
  const members = selected ? scope.members : [];
  const project = members.length === 1 ? members[0] : undefined;
  const supported = project && configs.get(project.environmentId)?.notificationInbox;
  const inboxReady = !!project && !!supported && settings.inboxEnabled;
  const result = useEnvironmentQuery(
    inboxReady
      ? inboxEnvironment.sources({
          environmentId: project.environmentId,
          input: { projectId: project.id },
        })
      : null,
  );
  const refreshSources = result.refresh;
  useEffect(() => {
    if (!inboxReady) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshSources();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [inboxReady, refreshSources]);
  const renderSource = (source: InboxSource) => {
    const reason = integrationDisabledReason(source, selected, members.length, settings);
    if (reason || !settings.inboxEnabled) return <InactiveSource source={source} />;
    if (!supported)
      return (
        <SettingsRow
          title="Connection"
          description="Update this environment to configure notification sources."
        />
      );
    const connection = result.data?.find(
      (connection) => connection.source === source && connection.projectId === project?.id,
    );
    if (!connection || !project)
      return <SettingsRow title="Connection" description={result.error ?? "Loading connection…"} />;
    const props = { environmentId: project.environmentId, connection, refresh: result.refresh };
    if (source === "slack")
      return <SlackConnection key={`${project.id}:${connection.connected}`} {...props} />;
    if (source === "linear")
      return <LinearNotifications key={`${project.id}:${connection.connected}`} {...props} />;
    return <SuperhumanConnection key={`${project.id}:${connection.connected}`} {...props} />;
  };
  return (
    <>
      <LinearSettings>
        <fieldset disabled={!inboxReady} className="contents">
          <div className="min-w-0 divide-y divide-border/50 [&>[data-slot=settings-row]]:rounded-none">
            {renderSource("linear")}
          </div>
        </fieldset>
      </LinearSettings>
      {(["slack", "superhuman"] as const).map((source) => {
        const reason = integrationDisabledReason(source, selected, members.length, settings);
        return (
          <SettingsSection
            key={source}
            id={source}
            title={source === "slack" ? "Slack" : "Superhuman"}
            icon={<InboxSourceLogo source={source} />}
          >
            <fieldset disabled={!!reason || !supported} className="contents">
              <div className="min-w-0 divide-y divide-border/50 [&>[data-slot=settings-row]]:rounded-none">
                {reason && <SettingsRow title="Project setup" description={reason} />}
                {source === "slack" && (
                  <OAuthClientIdSetting source="slack" disabled={!!reason || !supported} />
                )}
                {renderSource(source)}
              </div>
            </fieldset>
          </SettingsSection>
        );
      })}
    </>
  );
}
