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

function InboxPromptSetting({
  title,
  description,
  enabledKey,
  promptKey,
  placeholder,
}: {
  title: string;
  description: string;
  enabledKey: "inboxSummaryPromptEnabled" | "inboxAgentPromptEnabled";
  promptKey: "inboxSummaryPrompt" | "inboxAgentPrompt";
  placeholder: string;
}) {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const enabledMixed = useScopedSettingsMixed([enabledKey]);
  const promptMixed = useScopedSettingsMixed([promptKey]);
  return (
    <SettingsRow
      title={title}
      description={description}
      mixed={enabledMixed || promptMixed}
      serverScoped
      settingKeys={[enabledKey, promptKey]}
      control={
        <Switch
          aria-label={`Custom ${title.toLowerCase()}`}
          mixed={enabledMixed}
          checked={enabledMixed ? false : settings[enabledKey]}
          onCheckedChange={(enabled) => update({ [enabledKey]: enabled })}
        />
      }
    >
      {!enabledMixed && settings[enabledKey] && (
        <div className="mt-3 pb-3">
          <Textarea
            key={settings[promptKey]}
            aria-label={title}
            defaultValue={promptMixed ? "" : settings[promptKey]}
            placeholder={promptMixed ? "Mixed — enter a prompt for selected projects" : placeholder}
            rows={4}
            maxLength={8000}
            onBlur={(event) => {
              if (event.currentTarget.value !== (promptMixed ? "" : settings[promptKey]))
                update({ [promptKey]: event.currentTarget.value });
            }}
          />
        </div>
      )}
    </SettingsRow>
  );
}

export function InboxFeatureSettings() {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const { environment, target } = useSettingsScope();
  const summaryMixed = useScopedSettingsMixed(["inboxSummaryModelSelection"]);
  const agentMixed = useScopedSettingsMixed(["inboxAgentModelSelection"]);
  const resolutionMixed = useScopedSettingsMixed(["inboxPreResolution"]);
  const memoryMixed = useScopedSettingsMixed(["inboxMemoryEnabled"]);
  const providers = environment?.serverConfig?.providers ?? [];
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      target?.projectId ?? null,
    ),
  );
  const disabledReason = useScopedModelDisabledReason(settings, entries);
  return (
    <div className="mt-4 mb-3 divide-y divide-border/50 border-t border-border/50 pt-1 [&>[data-slot=settings-row]]:rounded-none">
      {(["inboxSummaryModelSelection", "inboxAgentModelSelection"] as const).map((key) => {
        const selection =
          settings[key] ??
          (key === "inboxAgentModelSelection" ? settings.defaultModelSelection : null) ??
          settings.textGenerationModelSelection;
        const label = key === "inboxSummaryModelSelection" ? "Summary model" : "Delegation model";
        return (
          <SettingsRow
            key={key}
            title={label}
            mixed={key === "inboxSummaryModelSelection" ? summaryMixed : agentMixed}
            serverScoped
            settingKeys={[key]}
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
                triggerAriaLabel={label}
                size="sm"
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                {...((key === "inboxSummaryModelSelection" ? summaryMixed : agentMixed)
                  ? { triggerLabel: "Mixed" }
                  : {})}
                getModelDisabledReason={disabledReason}
                onInstanceModelChange={(instanceId, model) => {
                  if (!disabledReason(instanceId, model))
                    update({ [key]: createModelSelection(instanceId, model) });
                }}
              />
            }
          />
        );
      })}
      <InboxPromptSetting
        title="Summary prompt"
        description="Customize the summary instructions. Off uses the built-in prompt."
        enabledKey="inboxSummaryPromptEnabled"
        promptKey="inboxSummaryPrompt"
        placeholder="Summarize the request and relevant details in one to five concise sentences."
      />
      <InboxPromptSetting
        title="Delegation prompt"
        description="Customize the Agent action. Agent chat still waits for your message."
        enabledKey="inboxAgentPromptEnabled"
        promptKey="inboxAgentPrompt"
        placeholder="Address this notification using its context. Leave empty for the built-in prompt."
      />
      <SettingsRow
        title="Suggested resolutions"
        mixed={resolutionMixed}
        serverScoped
        settingKeys={["inboxPreResolution"]}
        description="Add suggested steps or a draft response to the summary. Suggestions do not send messages or settle notifications."
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
        title="Project memory"
        mixed={memoryMixed}
        serverScoped
        settingKeys={["inboxMemoryEnabled"]}
        description="Use confirmed outcomes from similar notifications in this project. Other projects stay separate."
        control={
          <Switch
            aria-label="Project memory"
            mixed={memoryMixed}
            checked={memoryMixed ? false : settings.inboxMemoryEnabled}
            onCheckedChange={(inboxMemoryEnabled) => update({ inboxMemoryEnabled })}
          />
        }
      />
    </div>
  );
}
