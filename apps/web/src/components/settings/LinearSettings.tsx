import { LinearConnectionSettings } from "../linear/LinearConnectionSettings";
import { integrationDisabledReason } from "../inbox/integrationAvailability";
import { InboxSourceLogo } from "../inbox/InboxSourceLogo";
import { DisabledIntegrationConnectButton } from "../inbox/DisabledIntegrationConnectButton";
import { OAuthClientIdSetting } from "../inbox/OAuthClientIdSetting";
import { useRef, type ReactNode } from "react";
import { isElectron } from "~/env";
import { useServerConfigs } from "~/state/entities";
import { EnvironmentLinearSettings } from "../linear/EnvironmentLinearSettings";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { SettingsSection, SettingsRow } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function LinearSettings({ children }: { children?: ReactNode }) {
  const { scope, search } = useSettingsScope();
  const configs = useServerConfigs();
  const workspace = useScopedSettings((settings) => settings.linearWorkspace);
  const clientId = useScopedSettings((settings) => settings.linearClientId);
  const mixed = useScopedSettingsMixed(["linearWorkspace"]);
  const update = useUpdateScopedSettings();
  const workspaceEdited = useRef<string | null>(null);
  const projectSelected = scope.kind === "project" || scope.kind === "checkout";
  const projects = projectSelected
    ? scope.members.map((member) => ({ environmentId: member.environmentId, projectId: member.id }))
    : [];
  const reason = integrationDisabledReason(projectSelected, projects.length);
  const workspaceKey = JSON.stringify([search, workspace, mixed]);

  return (
    <SettingsSection id="linear" title="Linear" icon={<InboxSourceLogo source="linear" />}>
      {/* A native fieldset layout box can collapse container-query rows after save. */}
      <fieldset disabled={!!reason} className="contents">
        <div className="min-w-0 divide-y divide-border/50 [&>[data-slot=settings-row]]:rounded-none">
          <OAuthClientIdSetting source="linear" disabled={!!reason} />
          <SettingsRow
            id="linear-workspace"
            title="Workspace"
            serverScoped
            settingKeys={["linearWorkspace"]}
            mixed={mixed}
            description={
              projectSelected
                ? "The workspace in linear.app/<workspace>."
                : "Select a project above to configure its Linear workspace."
            }
            control={
              <div className="w-full sm:w-72">
                <Input
                  size="sm"
                  aria-label="Linear workspace"
                  disabled={!!reason}
                  key={workspaceKey}
                  defaultValue={mixed ? "" : workspace}
                  placeholder={mixed ? "Multiple workspaces" : "my-workspace"}
                  onInput={() => {
                    workspaceEdited.current = workspaceKey;
                  }}
                  onBlur={(event) => {
                    if (workspaceEdited.current !== workspaceKey) return;
                    workspaceEdited.current = null;
                    const value = event.target.value.trim();
                    if (reason || (!mixed && value === workspace)) return;
                    if (!/^(?:[a-zA-Z0-9][a-zA-Z0-9-]{0,127})?$/.test(value)) {
                      toastManager.add({
                        type: "error",
                        title: "Enter a workspace slug, not a URL",
                      });
                      return;
                    }
                    update({ linearWorkspace: value });
                  }}
                />
              </div>
            }
          />
          {reason ? (
            <SettingsRow
              title="Connection"
              description="Connect an account only for the selected project."
              control={<DisabledIntegrationConnectButton source="linear" reason={reason} />}
            />
          ) : projects.length === 1 &&
            configs.get(projects[0]!.environmentId)?.notificationInbox ? (
            <EnvironmentLinearSettings
              key={JSON.stringify([projects, workspace, clientId])}
              environmentId={projects[0]!.environmentId}
              projectId={projects[0]!.projectId}
              workspace={mixed ? "" : workspace}
            />
          ) : (
            isElectron && (
              <LinearConnectionSettings
                key={JSON.stringify([projects, workspace])}
                workspace={mixed ? "" : workspace}
                connectionKey={
                  projects.length === 1
                    ? JSON.stringify([projects[0]!.environmentId, projects[0]!.projectId])
                    : null
                }
              />
            )
          )}
          {children}
        </div>
      </fieldset>
    </SettingsSection>
  );
}
