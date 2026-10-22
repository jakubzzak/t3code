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
import { OAuthClientIdSetting } from "./OAuthClientIdSetting";
import { useScopedSettings } from "../settings/useScopedSettings";
import { InboxSourceLogo } from "./InboxSourceLogo";
import { useInboxSourceSettings } from "./useInboxSourceSettings";
import { useCommitOnBlur } from "~/hooks/useCommitOnBlur";
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
                  disabled={disabled || option.disabled}
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
  const { selection, saving, update } = useInboxSourceSettings(environmentId, connection, refresh);
  const { categories } = selection;
  const history = useCommitOnBlur(String(selection.initialLookbackDays), (value) => {
    const days = Number(value);
    if (Number.isInteger(days) && days >= 1 && days <= 90)
      void update({ initialLookbackDays: days });
  });
  const tokenInput = useCommitOnBlur(token, (value) => {
    setToken(value);
    if (value.trim())
      void update({}, Redacted.make(value.trim())).then((success) => {
        if (success) setToken("");
      });
  });
  const [pending, setPending] = useState(false);
  const canWrite = useAtomValue(inboxEnvironment.configureSource.permissionAtom(environmentId));
  const disconnect = useAtomCommand(inboxEnvironment.disconnectSource, { reportFailure: true });
  const sync = useAtomCommand(inboxEnvironment.refreshSource, { reportFailure: true });
  const canSync = useAtomValue(inboxEnvironment.refreshSource.permissionAtom(environmentId));
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
              disabled={!canWrite || pending || saving || !clientId}
              onClick={() => void connect()}
            >
              {connection.connected ? "Reconnect Slack" : "Connect Slack"}
            </Button>
            {connection.connected && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canSync || pending || saving || !categories.length}
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
            {authorizationUrl && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canWrite || pending || saving}
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
                disabled={!canWrite || pending || saving}
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
        {connection.lastSyncAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Last synced {new Date(connection.lastSyncAt).toLocaleString()}
          </p>
        )}
        {connection.error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {connection.error}
          </p>
        )}
      </SettingsRow>
      <SettingsRow
        title="Notification categories"
        description="Selected activity appears automatically in Inbox. Saved and To-dos are unavailable."
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
              void update((current) => ({
                categories: checked
                  ? [...current.categories, id]
                  : current.categories.filter((value) => value !== id),
              }))
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
              {...history}
              disabled={!canWrite || pending}
            />
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
            Slack app. An existing user token is saved when you leave the field or press Enter.
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
                {...tokenInput}
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
  const { selection, saving, update } = useInboxSourceSettings(environmentId, connection, refresh);
  const { accounts, categories } = selection;
  const [pending, setPending] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const canWrite = useAtomValue(inboxEnvironment.configureSource.permissionAtom(environmentId));
  const begin = useAtomCommand(inboxEnvironment.beginSuperhuman, { reportFailure: true });
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
              disabled={!canWrite || pending || saving}
              onClick={() => void connect()}
            >
              {connection.connected ? "Reconnect Superhuman" : "Connect Superhuman"}
            </Button>
            {connection.connected && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canWrite || pending || saving}
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
              void update((current) => {
                const accounts = checked
                  ? [...current.accounts, account]
                  : current.accounts.filter((value) => value !== account);
                const available = new Set([
                  ...(catalog.data?.splits ?? [])
                    .filter((entry) => accounts.includes(entry.accountEmail))
                    .map((entry) => `split:${entry.name}`),
                  ...(catalog.data?.labels ?? [])
                    .filter((entry) => accounts.includes(entry.accountEmail))
                    .map((entry) => `label:${entry.name}`),
                ]);
                return {
                  accounts,
                  categories: current.categories.filter((category) => available.has(category)),
                };
              })
            }
          />
        }
      />
      <SettingsRow
        title="Splits and labels"
        description={
          !connection.connected
            ? "Connect to choose Important and other email groups."
            : "Selected email groups appear automatically in this project’s Inbox."
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
              void update((current) => ({
                categories: checked
                  ? [...current.categories, category]
                  : current.categories.filter((value) => value !== category),
              }))
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
  const { selection, update } = useInboxSourceSettings(environmentId, connection, refresh);
  const { categories } = selection;
  const canWrite = useAtomValue(inboxEnvironment.configureSource.permissionAtom(environmentId));
  return (
    <>
      <SettingsRow
        title="Notification categories"
        description={
          connection.connected
            ? "Selected activity appears automatically in Inbox. Include everything, or choose categories."
            : "Connect Linear above to choose categories."
        }
        control={
          <IntegrationSelection
            label="Linear notification categories"
            selected={categories}
            disabled={!canWrite || !connection.connected}
            options={["all", ...LINEAR_INBOX_CATEGORIES].map((category) => ({
              value: category,
              label:
                category === "all"
                  ? "Everything"
                  : category
                      .replace(/([A-Z])/g, " $1")
                      .replace(/^./, (letter) => letter.toUpperCase()),
            }))}
            onToggle={(category, checked) =>
              void update((current) => ({
                categories:
                  category === "all"
                    ? checked
                      ? ["all"]
                      : []
                    : checked
                      ? [...current.categories.filter((value) => value !== "all"), category]
                      : current.categories.filter((value) => value !== category),
              }))
            }
          />
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
      return (
        <SlackConnection
          key={`${project.environmentId}:${project.id}:${connection.connected}`}
          {...props}
        />
      );
    if (source === "linear")
      return (
        <LinearNotifications
          key={`${project.environmentId}:${project.id}:${connection.connected}`}
          {...props}
        />
      );
    return (
      <SuperhumanConnection
        key={`${project.environmentId}:${project.id}:${connection.connected}`}
        {...props}
      />
    );
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
