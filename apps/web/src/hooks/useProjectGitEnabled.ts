import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useEnvironmentSettings } from "./useSettings";

export function useProjectGitEnabled(environmentId: EnvironmentId, projectId: ProjectId | null) {
  return useEnvironmentSettings(
    environmentId,
    (settings) => resolveProjectSettings(settings, projectId).settings.gitEnabled,
  );
}
