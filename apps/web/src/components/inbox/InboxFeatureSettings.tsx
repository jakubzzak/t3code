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
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

export function InboxFeatureSettings() {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const { environment, target } = useSettingsScope();
  const summaryMixed = useScopedSettingsMixed(["inboxSummaryModelSelection"]);
  const agentMixed = useScopedSettingsMixed(["inboxAgentModelSelection"]);
  const promptMixed = useScopedSettingsMixed(["inboxAgentPrompt"]);
  const resolutionMixed = useScopedSettingsMixed(["inboxPreResolution"]);
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
    <SettingsSection title="Inbox processing">
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
      <SettingsRow
        title="Agent prompt"
        mixed={promptMixed}
        serverScoped
        settingKeys={["inboxAgentPrompt"]}
        description="Used by the Agent action. Agent chat waits for your message."
      >
        <div className="mt-2">
          <Textarea
            key={settings.inboxAgentPrompt}
            aria-label="Agent prompt"
            defaultValue={promptMixed ? "" : settings.inboxAgentPrompt}
            placeholder={promptMixed ? "Mixed — enter a prompt for selected projects" : undefined}
            rows={4}
            maxLength={8000}
            onBlur={(event) => {
              if (event.currentTarget.value !== (promptMixed ? "" : settings.inboxAgentPrompt))
                update({ inboxAgentPrompt: event.currentTarget.value });
            }}
          />
        </div>
      </SettingsRow>
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
        description="Processing checks similar cases in this project and distinguishes confirmed outcomes from unconfirmed suggestions. Other projects are excluded."
      />
    </SettingsSection>
  );
}
