import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useCommitOnBlur } from "~/hooks/useCommitOnBlur";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { SettingsRow } from "../settings/settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "../settings/useScopedSettings";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function ClientIdEditor({
  name,
  value,
  mixed,
  disabled,
  onCommit,
}: {
  name: string;
  value: string;
  mixed: boolean;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const draft = useCommitOnBlur(mixed ? "" : value, (next) => onCommit(next.trim()));
  const label = `${revealed ? "Hide" : "Show"} ${name} OAuth client ID`;
  return (
    <div className="w-full sm:w-72">
      <InputGroup>
        <InputGroupInput
          {...draft}
          size="sm"
          type={revealed ? "text" : "password"}
          aria-label={`${name} OAuth client ID`}
          disabled={disabled}
          placeholder={mixed ? "Multiple client IDs" : "Enter client ID"}
          maxLength={256}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <InputGroupAddon align="inline-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={label}
                  aria-pressed={revealed}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setRevealed((current) => !current)}
                />
              }
            >
              {revealed ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
            </TooltipTrigger>
            <TooltipPopup>{label}</TooltipPopup>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

/** Public application identity, masked by default; tokens never populate this field. */
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
  return (
    <SettingsRow
      title={`${name} OAuth client ID`}
      serverScoped
      settingKeys={[key]}
      mixed={mixed}
      description={
        source === "linear"
          ? "Enter your Linear application's public client ID. Each connection still requires authorization."
          : "Enter your Slack application's public client ID. Enable PKCE in its OAuth settings. Each connection still requires authorization."
      }
      control={
        <ClientIdEditor
          key={JSON.stringify([source, search, disabled])}
          name={name}
          value={value}
          mixed={mixed}
          disabled={disabled || !selected}
          onCommit={(next) => {
            if (!disabled && selected && (mixed || next !== value)) update({ [key]: next });
          }}
        />
      }
    />
  );
}
