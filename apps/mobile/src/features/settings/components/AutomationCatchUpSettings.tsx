import { AuthSettingsWriteScope, type ServerSettingsPatch } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../../state/session";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useSettingsEnvironmentFilter } from "../settings-environment-filter";
import {
  planMobileScopedSettingsClear,
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
  uniformMobileSetting,
} from "../settings-scoped-server";
import { SettingsProjectOverridesSection } from "./SettingsProjectOverridesSection";
import { SettingsSection } from "./SettingsSection";
import { SettingsSwitchRow } from "./SettingsSwitchRow";
import { AppText } from "../../../components/AppText";

export function AutomationCatchUpSettings() {
  const { selectedTargets, selectedProjectKey, projectGroups } = useSettingsEnvironmentFilter();
  const project = projectGroups.find((group) => group.key === selectedProjectKey);
  const projectSelected = selectedProjectKey !== null;
  const targets = resolveMobileSettingsTargets(
    selectedTargets,
    projectSelected ? (project?.members.map((member) => member.project) ?? []) : null,
  );
  const writable = useEnvironmentsWithScope(selectedTargets, AuthSettingsWriteScope);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: true });
  const supported =
    targets.length > 0 &&
    targets.every(
      (target) =>
        target.environment.serverConfig.environment.capabilities.automationCatchUp === true &&
        (!projectSelected ||
          target.environment.serverConfig.environment.capabilities.projectSettingsOverrides ===
            true),
    );
  const disabled =
    pending ||
    !supported ||
    targets.some((target) => !writable.has(target.environment.environmentId));
  const save = (patch: ServerSettingsPatch | null) => {
    if (
      inFlight.current ||
      disabled ||
      targets.some(
        (target) => !readEnvironmentScope(target.environment.environmentId, AuthSettingsWriteScope),
      )
    )
      return;
    const writes =
      patch === null
        ? planMobileScopedSettingsClear(targets, ["automationCatchUpEnabled"])
        : planMobileScopedSettingsPatch(targets, projectSelected, patch);
    inFlight.current = true;
    setPending(true);
    void Promise.allSettled(
      writes.map((entry) =>
        update({ environmentId: entry.environmentId, input: { patch: entry.patch } }),
      ),
    ).finally(() => {
      inFlight.current = false;
      setPending(false);
    });
  };
  return (
    <>
      {projectSelected ? (
        <SettingsProjectOverridesSection
          projectLabel={project?.label ?? "Unavailable project"}
          supportsOverrides={supported}
          hasOverrides={targets.some(
            (target) => target.sources.automationCatchUpEnabled === "project",
          )}
          pending={pending}
          disabled={disabled}
          onClear={() => save(null)}
        />
      ) : null}
      <SettingsSection title="Scheduling">
        <SettingsSwitchRow
          icon="clock"
          label="Catch up missed automations"
          subtitle="When this environment starts or wakes, run each missed fixed-time automation once, then resume its normal schedule. Paused automations are excluded."
          value={uniformMobileSetting(targets, "automationCatchUpEnabled")}
          disabled={disabled}
          onValueChange={(value) => save({ automationCatchUpEnabled: value })}
        />
        {!supported ? (
          <AppText className="px-4 pb-3 text-sm text-foreground-muted">
            Update the selected environments to configure catch-up.
          </AppText>
        ) : null}
      </SettingsSection>
    </>
  );
}
