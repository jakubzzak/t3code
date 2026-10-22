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
import { Textarea } from "../ui/textarea";

function InboxProcessingGroup({ kind }: { kind: "summary" | "agent" }) {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const { environment, target } = useSettingsScope();
  const summary = kind === "summary";
  const enabledKey = summary ? "inboxSummaryEnabled" : "inboxAgentEnabled";
  const modelKey = summary ? "inboxSummaryModelSelection" : "inboxAgentModelSelection";
  const promptKey = summary ? "inboxSummaryPrompt" : "inboxAgentPrompt";
  const title = summary ? "Summary" : "Agent Delegation";
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
      title={title}
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
  const resolutionMixed = useScopedSettingsMixed(["inboxPreResolution"]);
  const memoryMixed = useScopedSettingsMixed(["inboxMemoryEnabled"]);
  return (
    <div className="mt-4 mb-3 divide-y divide-border/50 border-t border-border/50 pt-1 [&>[data-slot=settings-row]]:rounded-none">
      <InboxProcessingGroup kind="summary" />
      <InboxProcessingGroup kind="agent" />
      <SettingsRow
        title="Suggested resolutions"
        mixed={resolutionMixed}
        serverScoped
        settingKeys={["inboxPreResolution"]}
        description="Add suggested steps or a draft response when Summary is enabled. Suggestions do not send messages or settle notifications."
        control={
          <Switch
            aria-label="Suggested resolutions"
            mixed={resolutionMixed}
            checked={resolutionMixed ? false : settings.inboxPreResolution}
            onCheckedChange={(inboxPreResolution) => update({ inboxPreResolution })}
          />
        }
      />
      <SettingsRow
        title="Inbox memory"
        mixed={memoryMixed}
        serverScoped
        settingKeys={["inboxMemoryEnabled"]}
        description="Use confirmed outcomes from similar notifications in this project. Other projects stay separate."
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
