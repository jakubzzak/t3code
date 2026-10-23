import { BotIcon, LightbulbIcon, SparklesIcon } from "lucide-react";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import {
  useScopedSettings,
  useUpdateScopedSettings,
  useScopedSettingsMixed,
} from "../settings/useScopedSettings";
import { useScopedModelDisabledReason } from "../settings/useScopedModelAvailability";
import { SettingsRow, SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../settings/settingsLayout";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Switch } from "../ui/switch";
import { useCommitOnBlur } from "~/hooks/useCommitOnBlur";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

function InboxProcessingGroup({ kind }: { kind: "summary" | "agent" }) {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const { environment, target } = useSettingsScope();
  const summary = kind === "summary";
  const enabledKey = summary ? "inboxSummaryEnabled" : "inboxAgentEnabled";
  const modelKey = summary ? "inboxSummaryModelSelection" : "inboxAgentModelSelection";
  const promptKey = summary ? "inboxSummaryPrompt" : "inboxAgentPrompt";
  const title = summary ? "AI summary" : "Agent Delegation";
  const Icon = summary ? SparklesIcon : BotIcon;
  const modelLabel = summary ? "Summary model" : "Delegation model";
  const promptLabel = summary ? "Summary prompt" : "Delegation prompt";
  const enabledMixed = useScopedSettingsMixed([enabledKey]);
  const modelMixed = useScopedSettingsMixed([modelKey]);
  const promptMixed = useScopedSettingsMixed([promptKey]);
  const providers = environment?.serverConfig?.providers ?? [];
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      target?.projectId ?? null,
    ),
  );
  const disabledReason = useScopedModelDisabledReason(settings, entries);
  const selection =
    settings[modelKey] ??
    (!summary ? settings.defaultModelSelection : null) ??
    settings.textGenerationModelSelection;
  const prompt = settings[promptKey].trim()
    ? settings[promptKey]
    : DEFAULT_SERVER_SETTINGS[promptKey];
  return (
    <SettingsRow
      title={
        <span className="inline-flex items-center gap-1.5">
          <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          {title}
        </span>
      }
      description={
        summary
          ? "Add a concise AI summary to incoming notifications."
          : "Start an agent directly from a notification. Agent chat still waits for your message."
      }
      mixed={enabledMixed}
      serverScoped
      settingKeys={[enabledKey]}
      control={
        <Switch
          aria-label={title}
          mixed={enabledMixed}
          checked={enabledMixed ? false : settings[enabledKey]}
          onCheckedChange={(enabled) => update({ [enabledKey]: enabled })}
        />
      }
    >
      {!enabledMixed && settings[enabledKey] && (
        <div className="mt-3 mb-2 rounded-lg border border-border/50 bg-muted/15 [&>[data-slot=settings-row]]:rounded-none">
          <SettingsRow
            title={modelLabel}
            mixed={modelMixed}
            serverScoped
            settingKeys={[modelKey]}
            control={
              <ProviderModelPicker
                environmentId={environment?.environmentId ?? null}
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={entries}
                modelOptionsByInstance={getCustomModelOptionsByInstance(
                  settings,
                  providers,
                  selection.instanceId,
                  selection.model,
                )}
                triggerAriaLabel={modelLabel}
                size="sm"
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                {...(modelMixed ? { triggerLabel: "Mixed" } : {})}
                getModelDisabledReason={disabledReason}
                onInstanceModelChange={(instanceId, model) => {
                  if (!disabledReason(instanceId, model))
                    update({ [modelKey]: createModelSelection(instanceId, model) });
                }}
              />
            }
          />
          <div className="border-t border-border/50">
            <SettingsRow
              title={promptLabel}
              mixed={promptMixed}
              serverScoped
              settingKeys={[promptKey]}
            >
              <div className="mt-2 pb-2">
                <Textarea
                  key={`${promptMixed}:${prompt}`}
                  aria-label={promptLabel}
                  defaultValue={promptMixed ? "" : prompt}
                  placeholder={
                    promptMixed ? "Mixed — enter a prompt for selected projects" : undefined
                  }
                  rows={4}
                  maxLength={8000}
                  onBlur={(event) => {
                    const value = event.currentTarget.value.trim()
                      ? event.currentTarget.value
                      : DEFAULT_SERVER_SETTINGS[promptKey];
                    event.currentTarget.value = value;
                    if (promptMixed || value !== settings[promptKey])
                      update({ [promptKey]: value });
                  }}
                />
              </div>
            </SettingsRow>
          </div>
        </div>
      )}
    </SettingsRow>
  );
}

export function InboxFeatureSettings() {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const historyMixed = useScopedSettingsMixed(["inboxInitialHistoryDays"]);
  const history = useCommitOnBlur(
    historyMixed ? "" : String(settings.inboxInitialHistoryDays),
    (value) => {
      const days = Number(value);
      if (value.trim() && Number.isInteger(days) && days >= 0 && days <= 30)
        update({ inboxInitialHistoryDays: days });
    },
  );
  const refreshMixed = useScopedSettingsMixed(["inboxRefreshIntervalMinutes"]);
  const refresh = useCommitOnBlur(
    refreshMixed ? "" : String(settings.inboxRefreshIntervalMinutes),
    (value) => {
      const minutes = Number(value);
      if (value.trim() && Number.isInteger(minutes) && minutes >= 2 && minutes <= 60)
        update({ inboxRefreshIntervalMinutes: minutes });
    },
  );
  const resolutionMixed = useScopedSettingsMixed(["inboxPreResolution"]);
  const memoryMixed = useScopedSettingsMixed(["inboxMemoryEnabled"]);
  return (
    <div className="mt-4 mb-3 divide-y divide-border/50 border-t border-border/50 pt-1 [&>[data-slot=settings-row]]:rounded-none">
      <SettingsRow
        title="Initial history"
        description="Load 0–30 days of notifications across all connected sources when Inbox starts. Zero skips older messages and starts from when you enable Inbox. Existing notifications are kept."
        mixed={historyMixed}
        serverScoped
        settingKeys={["inboxInitialHistoryDays"]}
        control={
          <div className="w-full sm:w-72">
            <Input
              size="sm"
              type="number"
              aria-label="Inbox initial history days"
              min={0}
              max={30}
              step={1}
              placeholder={historyMixed ? "Mixed" : undefined}
              {...history}
            />
          </div>
        }
      />
      <SettingsRow
        title="Refresh interval"
        description="Check connected sources every 2–60 minutes. Only activity since the last successful fetch is collected."
        mixed={refreshMixed}
        serverScoped
        settingKeys={["inboxRefreshIntervalMinutes"]}
        control={
          <div className="w-full sm:w-72">
            <Input
              size="sm"
              type="number"
              aria-label="Inbox refresh interval minutes"
              min={2}
              max={60}
              step={1}
              placeholder={refreshMixed ? "Mixed" : undefined}
              {...refresh}
            />
          </div>
        }
      />
      <InboxProcessingGroup kind="summary" />
      <SettingsRow
        title={
          <span className="inline-flex items-center gap-1.5">
            <LightbulbIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            Suggested resolutions
          </span>
        }
        mixed={resolutionMixed}
        serverScoped
        settingKeys={["inboxPreResolution"]}
        description="Generate suggested steps or a draft response together with AI summary when both are enabled. Suggestions do not send messages or settle notifications."
        control={
          <Switch
            aria-label="Suggested resolutions"
            mixed={resolutionMixed}
            checked={resolutionMixed ? false : settings.inboxPreResolution}
            onCheckedChange={(inboxPreResolution) => update({ inboxPreResolution })}
          />
        }
      />
      <InboxProcessingGroup kind="agent" />
      <SettingsRow
        title="Inbox memory"
        mixed={memoryMixed}
        serverScoped
        settingKeys={["inboxMemoryEnabled"]}
        description="Build a database of recurring tasks and confirmed resolutions to recognize patterns and improve future suggestions. Notification and chat context remains available when this is off. Memory stays within this project."
        control={
          <Switch
            aria-label="Inbox memory"
            mixed={memoryMixed}
            checked={memoryMixed ? false : settings.inboxMemoryEnabled}
            onCheckedChange={(inboxMemoryEnabled) => update({ inboxMemoryEnabled })}
          />
        }
      />
    </div>
  );
}
