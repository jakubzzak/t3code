import { DEFAULT_SERVER_SETTINGS, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useEnvironmentServerConfig } from "./entities";

export function useProjectGitEnabled(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
) {
  const config = useEnvironmentServerConfig(environmentId);
  return resolveProjectSettings(config?.settings ?? DEFAULT_SERVER_SETTINGS, projectId).settings
    .gitEnabled;
}
