import { useEffect, useState } from "react";
import { AGENTIC_SEARCH_LABELS, DEFAULT_AGENTIC_SEARCH_PROMPTS } from "~/agenticSearch";
import { Textarea } from "~/components/ui/textarea";
import { createFileRoute } from "@tanstack/react-router";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { isElectron } from "~/env";
import {
  SettingsPageContainer,
  SettingsSection,
  SettingsRow,
  SettingResetButton,
} from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";

export const Route = createFileRoute("/settings/features")({ component: FeaturesSettings });

function FeaturesSettings() {
  const settings = useClientSettings();
  const enabled = settings.linearViewEnabled;
  const update = useUpdateClientSettings();
  return (
    <SettingsPageContainer>
      <SettingsSection title="Features">
        <SettingsRow
          id="agentic-search"
          title="Agentic search"
          description="Find answers in chats on the hosting environment, or include connected tools with Search everywhere. Launch from the command palette or a shortcut. Other machines are excluded. Applies to this device."
          control={
            <Switch
              aria-label="Agentic search"
              checked={settings.agenticSearchEnabled}
              onCheckedChange={(agenticSearchEnabled) => {
                void update({ agenticSearchEnabled }).catch(() =>
                  toastManager.add({ type: "error", title: "Could not save search preference" }),
                );
              }}
            />
          }
        />
        {settings.agenticSearchEnabled ? (
          <>
            <SearchPromptSetting
              label={AGENTIC_SEARCH_LABELS.chats}
              description="Find answers across projects and archived chats on the hosting environment, with source links."
              value={settings.agenticSearchChatsPrompt}
              defaultPrompt={DEFAULT_AGENTIC_SEARCH_PROMPTS.chats}
              save={(agenticSearchChatsPrompt) => update({ agenticSearchChatsPrompt })}
            />
            <SearchPromptSetting
              label={AGENTIC_SEARCH_LABELS.everywhere}
              description="Search chats and connected tools in parallel for a concise answer with sources."
              value={settings.agenticSearchEverywherePrompt}
              defaultPrompt={DEFAULT_AGENTIC_SEARCH_PROMPTS.everywhere}
              save={(agenticSearchEverywherePrompt) => update({ agenticSearchEverywherePrompt })}
            />
          </>
        ) : null}
        <SettingsRow
          id="linear-view"
          title="Linear view"
          description={
            isElectron
              ? "View and edit Linear issues beside your threads. Disabled by default; applies to this device."
              : "Available only in the desktop app"
          }
          control={
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
          }
        />
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
