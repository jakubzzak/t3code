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
          description="Search chats on the hosting environment, then connected integrations with Search everywhere. Launch from the command palette or a shortcut. Other machines are excluded. Applies to this device."
        >
          <Switch
            aria-label="Agentic search"
            checked={settings.agenticSearchEnabled}
            onCheckedChange={(agenticSearchEnabled) => {
              void update({ agenticSearchEnabled }).catch(() =>
                toastManager.add({ type: "error", title: "Could not save search preference" }),
              );
            }}
          />
        </SettingsRow>
        {settings.agenticSearchEnabled ? (
          <div className="space-y-4">
            <SearchPromptSetting
              label={AGENTIC_SEARCH_LABELS.chats}
              value={settings.agenticSearchChatsPrompt}
              defaultPrompt={DEFAULT_AGENTIC_SEARCH_PROMPTS.chats}
              save={(agenticSearchChatsPrompt) => update({ agenticSearchChatsPrompt })}
            />
            <SearchPromptSetting
              label={AGENTIC_SEARCH_LABELS.everywhere}
              value={settings.agenticSearchEverywherePrompt}
              defaultPrompt={DEFAULT_AGENTIC_SEARCH_PROMPTS.everywhere}
              save={(agenticSearchEverywherePrompt) => update({ agenticSearchEverywherePrompt })}
            />
          </div>
        ) : null}
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

function SearchPromptSetting({
  label,
  value,
  defaultPrompt,
  save,
}: {
  label: string;
  value: string;
  defaultPrompt: string;
  save: (value: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value || defaultPrompt);
  useEffect(() => setDraft(value || defaultPrompt), [value, defaultPrompt]);
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span>{label} — default prompt</span>
      <Textarea
        aria-label={`${label} default prompt`}
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
      <span className="text-xs text-muted-foreground">
        Saved when you leave the field. Clear to restore the default. Editing this prompt never
        starts a search.
      </span>
    </label>
  );
}
