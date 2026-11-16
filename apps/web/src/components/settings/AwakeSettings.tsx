import { useState } from "react";
import type { ClientSettingsPatch } from "@t3tools/contracts";
import { persistClientSettingsUpdate, useClientSettings } from "../../hooks/useSettings";
import {
  awakeStatusText,
  getDesktopAwakeBridge,
  useDesktopAwakeState,
} from "../../lib/desktopAwake";
import { Button } from "../ui/button";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function AwakeSettings() {
  const settings = useClientSettings();
  const updateClientSettings = (patch: ClientSettingsPatch) =>
    persistClientSettingsUpdate((current) => ({ ...current, ...patch }));
  const bridge = getDesktopAwakeBridge();
  const [state, setState] = useDesktopAwakeState();
  const [pending, setPending] = useState(false);
  const available = Boolean(bridge) && state?.supported === true;
  const installed = state?.installed === true;
  const hotspotAvailable = available && state?.hotspotMessage !== undefined;

  async function perform(action: () => Promise<unknown>) {
    if (pending) return;
    setPending(true);
    try {
      await action();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not update Keep awake",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPending(false);
    }
  }
  const update = (patch: ClientSettingsPatch) => void perform(() => updateClientSettings(patch));

  return (
    <SettingsPageContainer>
      <SettingsSection id="awake" title="Keep awake">
        <SettingsRow
          {...searchableSetting("awake-enabled")}
          description="The same instance-wide switch as Settings → Features. Keeps this Mac awake while Blackbird runs, including with the lid closed. Applies to all projects in this instance, not a remote computer. The display can turn off and lock. Uses more battery."
          status={
            !bridge || state?.supported === false
              ? "Available only in the macOS desktop app."
              : awakeStatusText(state)
          }
          control={
            <Switch
              aria-label="Keep this Mac awake"
              checked={settings.awakeEnabled}
              disabled={!available || pending || (!installed && !settings.awakeEnabled)}
              onCheckedChange={(checked) => update({ awakeEnabled: checked })}
            />
          }
        />
        {available ? (
          <SettingsRow
            title="Closed-lid setup"
            description="One-time administrator setup lets Blackbird manage sleep and Low Power Mode, with automatic recovery if it stops unexpectedly. Other apps running under your macOS account can use this permission outside Blackbird’s battery and heat safeguards. Remove setup revokes the permission; turning Keep awake off only stops Blackbird’s session."
            control={
              <div className="flex gap-2">
                {state?.status === "error" && installed ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void perform(async () => {
                        if (bridge) setState(await bridge.retryAwake());
                      })
                    }
                  >
                    Retry
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void perform(async () => {
                      if (!bridge) return;
                      if (installed) {
                        await updateClientSettings({ awakeEnabled: false });
                        setState(await bridge.removeAwake());
                      } else setState(await bridge.setupAwake());
                    })
                  }
                >
                  {pending ? "Working…" : installed ? "Remove setup" : "Set up…"}
                </Button>
              </div>
            }
          />
        ) : null}
      </SettingsSection>
      {available ? (
        <SettingsSection id="awake-hotspot" title="Hotspot failover">
          <SettingsRow
            {...searchableSetting("awake-hotspot")}
            description="When the internet drops while Keep awake is active, turn on and join your nearby iPhone’s Personal Hotspot, then return to known Wi-Fi when available. Uses mobile data. Both devices need the same Apple Account. Allow Location Services for Blackbird Hotspot to discover Wi-Fi networks. Turning this off stops checks without disconnecting your current network."
            status={
              !hotspotAvailable
                ? "Update the desktop app to use hotspot failover."
                : !settings.awakeHotspotFailover
                  ? "Off. Your Mac manages network connections."
                  : (state?.hotspotMessage ??
                    (state?.status === "active"
                      ? "Watching the internet connection."
                      : "Waiting for Keep awake to become active. Your preference is saved."))
            }
            control={
              <Switch
                aria-label="Hotspot failover"
                checked={settings.awakeHotspotFailover}
                disabled={!hotspotAvailable || pending}
                onCheckedChange={(checked) => update({ awakeHotspotFailover: checked })}
              />
            }
          />
        </SettingsSection>
      ) : null}
      {available ? (
        <SettingsSection id="awake-power" title="Battery and heat">
          <SettingsRow
            {...searchableSetting("awake-low-power")}
            description="On battery, use Low Power Mode below this percentage. Previous power settings are restored when it is no longer needed."
            control={
              <div className="w-24">
                <NumberField
                  value={settings.awakeLowPowerBelowPercent}
                  min={settings.awakeSleepBelowPercent}
                  max={100}
                  step={1}
                  size="sm"
                  disabled={pending}
                  onValueCommitted={(value) => {
                    if (value !== null) update({ awakeLowPowerBelowPercent: Math.round(value) });
                  }}
                >
                  <NumberFieldGroup>
                    <NumberFieldInput aria-label="Low Power Mode below percent" />
                  </NumberFieldGroup>
                </NumberField>
              </div>
            }
          />
          <SettingsRow
            {...searchableSetting("awake-sleep-below")}
            description="On battery, allow normal sleep below this percentage. Zero disables this limit. Keep awake resumes when the battery recovers or power is connected."
            control={
              <div className="w-24">
                <NumberField
                  value={settings.awakeSleepBelowPercent}
                  min={0}
                  max={settings.awakeLowPowerBelowPercent}
                  step={1}
                  size="sm"
                  disabled={pending}
                  onValueCommitted={(value) => {
                    if (value !== null) update({ awakeSleepBelowPercent: Math.round(value) });
                  }}
                >
                  <NumberFieldGroup>
                    <NumberFieldInput aria-label="Allow sleep below percent" />
                  </NumberFieldGroup>
                </NumberField>
              </div>
            }
          />
          <SettingsRow
            {...searchableSetting("awake-heat")}
            description="Use Low Power Mode at serious thermal pressure and allow sleep at critical thermal pressure. Keep awake resumes when the Mac cools down."
            control={
              <Switch
                aria-label="Heat safeguards"
                checked={settings.awakeHeatRules}
                disabled={pending}
                onCheckedChange={(checked) => update({ awakeHeatRules: checked })}
              />
            }
          />
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
