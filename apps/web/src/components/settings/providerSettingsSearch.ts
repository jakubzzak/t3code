import type { EnvironmentId, ProviderInstanceId, ServerSettings } from "@t3tools/contracts";
import { derivePhysicalProjectKey } from "@t3tools/client-runtime/state/project-grouping";
import type { Project } from "../../types";

/** Open the setting that disabled this provider, without broadening a checkout override. */
export function providerSettingsSearch(
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId,
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
  project: Project | null,
) {
  const projectDisabled =
    project?.environmentId === environmentId &&
    settings.projectSettingsOverrides[project.id]?.providerInstances?.[instanceId]?.enabled ===
      false;
  const projectKey = projectDisabled ? derivePhysicalProjectKey(project) : undefined;
  return {
    environmentId,
    instanceId,
    machine: environmentId,
    project: projectKey,
    checkout: projectKey,
  };
}
