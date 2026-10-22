import { createFileRoute, Link } from "@tanstack/react-router";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { isElectron } from "~/env";
import { useDesktopAwakeState } from "~/lib/desktopAwake";
import { searchableSetting } from "~/components/settings/settingsSearch";
import { Button } from "~/components/ui/button";
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
  const awakeEnabled = useClientSettings((settings) => settings.awakeEnabled);
  const [awakeState] = useDesktopAwakeState();
  const awakeSupported = awakeState?.supported === true;
  const update = useUpdateClientSettings();
  return (
    <SettingsPageContainer>
      <SettingsSection title="Features">
        <SettingsRow
          {...searchableSetting("feature-keep-awake")}
          description={
            awakeSupported
              ? "Keep this Mac awake while this Blackbird desktop instance runs. Applies to all projects in this instance, not to a remote computer. Configure one-time administrator setup and battery/heat safeguards before first use."
              : "Available only in the macOS desktop app. Applies to the whole desktop instance, not individual projects."
          }
          control={
            <div className="flex items-center gap-2">
              {awakeSupported ? (
                <Button size="xs" variant="outline" render={<Link to="/settings/awake" />}>
                  Configure
                </Button>
              ) : null}
              <Switch
                aria-label="Keep awake"
                checked={awakeEnabled}
                disabled={!awakeSupported && !awakeEnabled}
                onCheckedChange={(awakeEnabled) => {
                  void update({ awakeEnabled }).catch(() =>
                    toastManager.add({ type: "error", title: "Could not save feature preference" }),
                  );
                }}
              />
            </div>
          }
        />
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
