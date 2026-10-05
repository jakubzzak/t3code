import { useRef } from "react";
import { patchLinearProjectEmails, resolveLinearProjectEmail } from "~/browser/linearProjectEmail";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { SettingsSection, SettingsRow } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function LinearSettings() {
  const { scope, search } = useSettingsScope();
  const workspace = useScopedSettings((settings) => settings.linearWorkspace);
  const mixed = useScopedSettingsMixed(["linearWorkspace"]);
  const update = useUpdateScopedSettings();
  const emails = useClientSettings((settings) => settings.linearProjectLoginEmails);
  const workspaceEdited = useRef<string | null>(null);
  const emailEdited = useRef<string | null>(null);
  const updateClient = useUpdateClientSettings();
  const projectSelected = scope.kind === "project" || scope.kind === "checkout";
  const projects = projectSelected
    ? scope.members.map((member) => ({ environmentId: member.environmentId, projectId: member.id }))
    : [];
  const email = resolveLinearProjectEmail(emails, projects);
  const workspaceKey = JSON.stringify([search, workspace, mixed]);
  const emailKey = JSON.stringify([search, email]);

  return (
    <SettingsSection id="linear" title="Linear">
      <SettingsRow
        id="linear-workspace"
        title="Workspace"
        serverScoped
        settingKeys={["linearWorkspace"]}
        mixed={mixed}
        description={
          projectSelected
            ? "Workspace slug from linear.app/<workspace>. Applies to the selected project."
            : "Select a project above to configure its Linear workspace."
        }
      >
        <Input
          aria-label="Linear workspace"
          disabled={!projectSelected}
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
            if (!projectSelected || (!mixed && value === workspace)) return;
            if (!/^(?:[a-zA-Z0-9][a-zA-Z0-9-]{0,127})?$/.test(value)) {
              toastManager.add({ type: "error", title: "Enter a workspace slug, not a URL" });
              return;
            }
            update({ linearWorkspace: value });
          }}
        />
      </SettingsRow>
      <SettingsRow
        id="linear-login-email"
        title="Login email"
        description={
          projectSelected
            ? "Email override for this project on this device. Otherwise uses your T3 account email; you finish authentication yourself."
            : "Select a project above to configure its Linear login email."
        }
      >
        <Input
          aria-label="Linear login email"
          type="email"
          disabled={!projectSelected}
          key={emailKey}
          defaultValue={email.value}
          placeholder={email.mixed ? "Multiple login emails" : "T3 account email"}
          onInput={() => {
            emailEdited.current = emailKey;
          }}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (
              !projectSelected ||
              emailEdited.current !== emailKey ||
              (!email.mixed && value === email.value)
            )
              return;
            emailEdited.current = null;
            void updateClient({
              linearProjectLoginEmails: patchLinearProjectEmails(emails, projects, value),
            }).catch(() =>
              toastManager.add({ type: "error", title: "Could not save login email" }),
            );
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
