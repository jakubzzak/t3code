import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useEffect, useRef } from "react";
import { useThreadShells } from "../state/entities";
import { useRightPanelStore } from "../rightPanelStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { usePreviewMiniPlayerStore } from "../previewMiniPlayerStore";

/** Mirror server settlement, including automatic cleanup and changes from another client. */
export function ThreadSettledTools() {
  const threads = useThreadShells();
  const observed = useRef(new Map<string, string | null>());
  useEffect(() => {
    const next = new Map<string, string | null>();
    for (const thread of threads) {
      const target = scopeThreadRef(thread.environmentId, thread.id);
      const key = scopedThreadKey(target);
      const settledAt = thread.settledAt;
      next.set(key, settledAt);
      if (settledAt === null || observed.current.get(key) === settledAt) continue;
      useRightPanelStore.getState().closeAllSurfaces(target);
      useTerminalUiStateStore.getState().clearTerminalUiState(target);
      usePreviewMiniPlayerStore.getState().close(target);
    }
    observed.current = next;
  }, [threads]);
  return null;
}
