import type { ClientSettings, ScopedProjectRef } from "@t3tools/contracts";

type Emails = ClientSettings["linearProjectLoginEmails"];

export const linearProjectEmailKey = (project: ScopedProjectRef) =>
  JSON.stringify([project.environmentId, project.projectId]);

export function resolveLinearProjectEmail(emails: Emails, projects: readonly ScopedProjectRef[]) {
  const values = projects.map((project) => emails[linearProjectEmailKey(project)] ?? "");
  const mixed = values.some((value) => value !== values[0]);
  return { value: mixed ? "" : (values[0] ?? ""), mixed };
}

export function patchLinearProjectEmails(
  emails: Emails,
  projects: readonly ScopedProjectRef[],
  email: string,
) {
  const next = { ...emails };
  for (const project of projects) {
    const key = linearProjectEmailKey(project);
    if (email.trim()) next[key] = email.trim();
    else delete next[key];
  }
  return next;
}
