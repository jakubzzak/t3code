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
  const email = useClientSettings((settings) => settings.linearLoginEmail);
  const updateClient = useUpdateClientSettings();
  const projectSelected = scope.kind === "project" || scope.kind === "checkout";

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
          key={JSON.stringify([search, workspace, mixed])}
          defaultValue={mixed ? "" : workspace}
          placeholder={mixed ? "Multiple workspaces" : "my-workspace"}
          onBlur={(event) => {
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
        description="Optional override for this device. Otherwise uses your T3 account email when available; you finish authentication yourself."
      >
        <Input
          aria-label="Linear login email"
          type="email"
          key={email}
          defaultValue={email}
          placeholder="T3 account email"
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value === email) return;
            void updateClient({ linearLoginEmail: value }).catch(() =>
              toastManager.add({ type: "error", title: "Could not save login email" }),
            );
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
