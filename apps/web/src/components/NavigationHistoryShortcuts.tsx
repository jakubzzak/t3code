import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useEffect, useMemo } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { primaryServerKeybindingsAtom } from "../state/server";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { resolveThreadRouteTarget } from "../threadRoutes";

// Files owns back/forward while active; other surfaces use the app's route history.
export function NavigationHistoryShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const draft = useComposerDraftStore((state) =>
    routeTarget?.kind === "draft" ? state.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = useMemo(
    () =>
      routeTarget?.kind === "server"
        ? routeTarget.threadRef
        : draft
          ? (draft.promotedTo ?? scopeThreadRef(draft.environmentId, draft.threadId))
          : null,
    [draft, routeTarget],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent, fileHistoryOnly = false) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeThreadRef
            ? selectThreadTerminalUiState(
                useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
                routeThreadRef,
              ).terminalOpen
            : false,
          previewFocus: isPreviewFocused(),
          previewOpen: routeThreadRef
            ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, routeThreadRef) ===
              "preview"
            : false,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "navigation.back" && command !== "navigation.forward") return;

      const navigatedFileHistory =
        routeThreadRef !== null &&
        useRightPanelStore
          .getState()
          .navigateFileHistory(routeThreadRef, command === "navigation.back" ? -1 : 1);
      if (fileHistoryOnly && !navigatedFileHistory) return;
      event.preventDefault();
      event.stopPropagation();
      if (navigatedFileHistory) return;
      if (command === "navigation.back") window.history.back();
      else window.history.forward();
    };

    // Capture ahead of the source editor so its indentation keymap cannot
    // swallow the navigation chord, including inside its shadow root.
    const onFileKeyDown = (event: KeyboardEvent) => onKeyDown(event, true);
    window.addEventListener("keydown", onFileKeyDown, true);
    // Route navigation bubbles so browser chrome can retain its own history.
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onFileKeyDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [keybindings, routeThreadRef]);

  return null;
}
