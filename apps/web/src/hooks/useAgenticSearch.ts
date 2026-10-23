import { useCallback, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { agenticSearchTemplate, type AgenticSearchScope } from "~/agenticSearch";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useThreadShell } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { resolveThreadRouteTarget } from "~/threadRoutes";
import { toastManager } from "~/components/ui/toast";
import { useNewThreadHandler } from "./useHandleNewThread";
import { useScratchProject } from "./useScratchProject";
import { useClientSettings } from "./useSettings";

/** Both palette and keyboard launches prepare the same ordinary scratch draft. */
export function useAgenticSearch() {
  const settings = useClientSettings();
  const target = useParams({ strict: false, select: resolveThreadRouteTarget });
  const thread = useThreadShell(target?.kind === "server" ? target.threadRef : null);
  const draft = useComposerDraftStore((store) =>
    target?.kind === "draft" ? store.getDraftSession(target.draftId) : null,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const environmentId = scratchEnvironmentId(
    thread?.environmentId ?? draft?.environmentId ?? primaryEnvironmentId,
  );
  const supported =
    environments.find((entry) => entry.environmentId === environmentId)?.serverConfig
      ?.agenticSearch === true;
  const unavailableReason = !environmentId
    ? "Connect an environment that supports chats without a project"
    : !supported
      ? "Update this environment’s Blackbird server to use agentic search"
      : null;
  const newThread = useNewThreadHandler();
  const launching = useRef(false);
  const launch = useCallback(
    async (scope: AgenticSearchScope, presentation: "explicit" | "implicit", query?: string) => {
      if (!settings.agenticSearchEnabled || launching.current) return;
      if (unavailableReason || !environmentId) {
        toastManager.add({ type: "error", title: unavailableReason ?? "Connect an environment" });
        return;
      }
      launching.current = true;
      try {
        const template = agenticSearchTemplate(settings, scope);
        const project = await openScratchProject(environmentId);
        if (!project) return;
        const opened = await newThread(scopeProjectRef(environmentId, project.id), {
          forceNew: true,
          envMode: "local",
        });
        if (!opened) return;
        const store = useComposerDraftStore.getState();
        store.setPrompt(
          opened.draftId,
          presentation === "explicit" ? `${template}\n\nQuestion:\n` : (query ?? ""),
        );
        store.setDraftThreadContext(opened.draftId, {
          environmentSelection: "manual",
          search: { scope, template, presentation, autoSubmit: Boolean(query?.trim()) },
        });
      } catch {
        toastManager.add({ type: "error", title: "Could not prepare search chat" });
      } finally {
        launching.current = false;
      }
    },
    [environmentId, newThread, openScratchProject, settings, unavailableReason],
  );
  return {
    enabled: settings.agenticSearchEnabled,
    available: unavailableReason === null,
    unavailableReason,
    launch,
  };
}
