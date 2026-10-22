import { useRef } from "react";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { SettingsRow } from "../settings/settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "../settings/useScopedSettings";
import { Input } from "../ui/input";

/** Public application identity; access and refresh tokens never populate this field. */
export function OAuthClientIdSetting({
  source,
  disabled = false,
}: {
  source: "linear" | "slack";
  disabled?: boolean;
}) {
  const key = source === "linear" ? "linearClientId" : "slackClientId";
  const name = source === "linear" ? "Linear" : "Slack";
  const value = useScopedSettings((settings) => settings[key]);
  const mixed = useScopedSettingsMixed([key]);
  const update = useUpdateScopedSettings();
  const { scope, search } = useSettingsScope();
  const selected = scope.kind === "project" || scope.kind === "checkout";
  const identity = JSON.stringify([search, value, mixed]);
  const edited = useRef<string | null>(null);
  return (
    <SettingsRow
      title={`${name} OAuth client ID`}
      serverScoped
      settingKeys={[key]}
      mixed={mixed}
      description={
        source === "linear"
          ? "Your Linear application's public client ID. Leave blank to use this environment's configured application. Each connection still requires authorization."
          : "Your Slack application's public client ID. Enable PKCE in the app's OAuth settings. Each connection still requires authorization."
      }
      control={
        <div className="w-full sm:w-72">
          <Input
            key={identity}
            size="sm"
            aria-label={`${name} OAuth client ID`}
            disabled={disabled || !selected}
            defaultValue={mixed ? "" : value}
            placeholder={
              mixed
                ? "Multiple client IDs"
                : source === "linear"
                  ? "Environment default"
                  : "123456.789012"
            }
            maxLength={256}
            autoComplete="off"
            onInput={() => {
              edited.current = identity;
            }}
            onBlur={(event) => {
              if (edited.current !== identity) return;
              edited.current = null;
              const next = event.target.value.trim();
              if (!disabled && selected && (mixed || next !== value)) update({ [key]: next });
            }}
          />
        </div>
      }
    />
  );
}
