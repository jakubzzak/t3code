import { useEffect, useState } from "react";
import { AGENTIC_SEARCH_LABELS, DEFAULT_AGENTIC_SEARCH_PROMPTS } from "~/agenticSearch";
import { Textarea } from "~/components/ui/textarea";
import { useServerConfigs } from "~/state/entities";
import { InboxFeatureSettings } from "~/components/inbox/InboxFeatureSettings";
import { createFileRoute } from "@tanstack/react-router";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { isElectron } from "~/env";
import {
  SettingsPageContainer,
  SettingsSection,
  SettingsRow,
  SettingResetButton,
} from "~/components/settings/settingsLayout";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "~/components/settings/useScopedSettings";
import { Switch } from "~/components/ui/switch";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";

export const Route = createFileRoute("/settings/features")({ component: FeaturesSettings });

function FeaturesSettings() {
  const clientSettings = useClientSettings();
  const updateClient = useUpdateClientSettings();
  const configs = useServerConfigs();
  const { scope } = useSettingsScope();
  const settings = useScopedSettings((settings) => settings);
  const mixed = useScopedSettingsMixed(["linearViewEnabled"]);
  const inboxMixed = useScopedSettingsMixed(["inboxEnabled"]);
  const legacyEnabled = useClientSettings((settings) => settings.linearViewEnabled);
  const update = useUpdateScopedSettings();
  const projectSelected = scope.kind === "project" || scope.kind === "checkout";
  const supported =
    projectSelected &&
    scope.members.every((member) => configs.get(member.environmentId)?.notificationInbox);
  return (
    <SettingsPageContainer>
      <SettingsSection title="Features">
        {projectSelected && !supported && (
          <p className="text-xs text-muted-foreground">
            Update the selected environment to configure project features.
          </p>
        )}
        {legacyEnabled && !settings.linearViewEnabled && (
          <SettingsRow
            title="Move your Linear preference to projects"
            description="Linear view was enabled on this device. Select each project above, then enable it here. Your connections and workspace settings are preserved."
          >
            <Button
              variant="outline"
              disabled={!supported || !isElectron}
              onClick={() => update({ linearViewEnabled: true })}
            >
              Enable for selected project
            </Button>
          </SettingsRow>
        )}
        <SettingsRow
          id="agentic-search"
          title="Agentic search"
          description="Find answers in chats on the hosting environment, or include connected tools with Search everywhere. Launch from the command palette or a shortcut. Other machines are excluded. Applies to this device."
          control={
            <Switch
              aria-label="Agentic search"
              checked={clientSettings.agenticSearchEnabled}
              onCheckedChange={(agenticSearchEnabled) => {
                void updateClient({ agenticSearchEnabled }).catch(() =>
                  toastManager.add({ type: "error", title: "Could not save search preference" }),
                );
              }}
            />
          }
        />
        {clientSettings.agenticSearchEnabled ? (
          <>
            <SearchPromptSetting
              label={AGENTIC_SEARCH_LABELS.chats}
              description="Find answers across projects and archived chats on the hosting environment, with source links."
              value={clientSettings.agenticSearchChatsPrompt}
              defaultPrompt={DEFAULT_AGENTIC_SEARCH_PROMPTS.chats}
              save={(agenticSearchChatsPrompt) => updateClient({ agenticSearchChatsPrompt })}
            />
            <SearchPromptSetting
              label={AGENTIC_SEARCH_LABELS.everywhere}
              description="Search chats and connected tools in parallel for a concise answer with sources."
              value={clientSettings.agenticSearchEverywherePrompt}
              defaultPrompt={DEFAULT_AGENTIC_SEARCH_PROMPTS.everywhere}
              save={(agenticSearchEverywherePrompt) => updateClient({ agenticSearchEverywherePrompt })}
            />
          </>
        ) : null}
        <SettingsRow
          id="linear-view"
          title="Linear view"
          serverScoped
          settingKeys={["linearViewEnabled"]}
          mixed={mixed}
          description={
            !projectSelected
              ? "Select a project above to enable Linear view."
              : isElectron
                ? "View and edit Linear issues beside this project's chats."
                : "Available only in the desktop app."
          }
          control={
            <Switch
              aria-label="Linear view"
              checked={projectSelected && !mixed ? settings.linearViewEnabled : false}
              mixed={mixed}
              disabled={!supported || !isElectron}
              onCheckedChange={(linearViewEnabled) => update({ linearViewEnabled })}
            />
          }
        />
        <SettingsRow
          id="notification-inbox"
          title="Inbox"
          serverScoped
          settingKeys={["inboxEnabled"]}
          mixed={inboxMixed}
          description={
            projectSelected
              ? "Collect notifications in this project's sidebar. Configure sources in Integrations."
              : "Select a project above to enable its inbox."
          }
          control={
            <Switch
              aria-label="Inbox"
              checked={projectSelected && !inboxMixed ? settings.inboxEnabled : false}
              mixed={inboxMixed}
              disabled={!supported}
              onCheckedChange={(inboxEnabled) => update({ inboxEnabled })}
            />
          }
        >
          {projectSelected && !inboxMixed && settings.inboxEnabled && <InboxFeatureSettings />}
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function SearchPromptSetting({
  label,
  description,
  value,
  defaultPrompt,
  save,
}: {
  label: string;
  description: string;
  value: string;
  defaultPrompt: string;
  save: (value: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value || defaultPrompt);
  useEffect(() => setDraft(value || defaultPrompt), [value, defaultPrompt]);
  return (
    <SettingsRow
      title={label}
      description={description}
      resetAction={
        draft.trim() !== defaultPrompt ? (
          <SettingResetButton
            label={`${label} prompt`}
            onClick={() => {
              void save("")
                .then(() => setDraft(defaultPrompt))
                .catch(() =>
                  toastManager.add({ type: "error", title: "Could not reset search prompt" }),
                );
            }}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          aria-label={`${label} prompt`}
          value={draft}
          rows={6}
          maxLength={16000}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const next = draft.trim() === defaultPrompt ? "" : draft;
            void save(next)
              .then(() => {
                if (!next.trim()) setDraft(defaultPrompt);
              })
              .catch(() =>
                toastManager.add({ type: "error", title: "Could not save search prompt" }),
              );
          }}
        />
      </div>
    </SettingsRow>
  );
}
