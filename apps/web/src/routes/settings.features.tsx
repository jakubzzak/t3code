import { createFileRoute } from "@tanstack/react-router";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { isElectron } from "~/env";
import {
  SettingsPageContainer,
  SettingsSection,
  SettingsRow,
} from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";

export const Route = createFileRoute("/settings/features")({ component: FeaturesSettings });

function FeaturesSettings() {
  const enabled = useClientSettings((settings) => settings.linearViewEnabled);
  const update = useUpdateClientSettings();
  return (
    <SettingsPageContainer>
      <SettingsSection title="Features">
        <SettingsRow
          id="linear-view"
          title="Linear view"
          description={
            isElectron
              ? "View and edit Linear issues beside your threads. Disabled by default; applies to this device."
              : "Available only in the desktop app"
          }
        >
          <Switch
            aria-label="Linear view"
            checked={enabled}
            disabled={!isElectron}
            onCheckedChange={(linearViewEnabled) => {
              void update({ linearViewEnabled }).catch(() =>
                toastManager.add({ type: "error", title: "Could not save feature preference" }),
              );
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
