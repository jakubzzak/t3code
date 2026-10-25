/** Connections belong to one explicit project, never an environment-wide selection. */
export function integrationDisabledReason(projectSelected: boolean, projectCount: number) {
  if (!projectSelected) return "Select a project above.";
  if (projectCount !== 1)
    return "Select one project checkout or environment above to configure its connection.";
  return null;
}
