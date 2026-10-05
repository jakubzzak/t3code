import {
  FILL_PREVIEW_VIEWPORT,
  type EnvironmentId,
  type PreviewCloseInput,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { linearInitialUrl } from "~/browser/linear";
import type { OpenPreviewMutation } from "~/browser/openFileInPreview";
import { isElectron } from "~/env";
import { ensureClientSettingsHydrated, getClientSettings } from "~/hooks/useSettings";
import { readThreadPreviewState, beginPreviewSessionClose } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { openPreviewSession } from "../preview/openPreviewSession";

/** Reuse an open Linear surface without retargeting it when the branch changes. */
export async function openLinearSurface<E>(input: {
  threadRef: ScopedThreadRef;
  workspace: string;
  branch: string | null | undefined;
  url?: string;
  openPreview: OpenPreviewMutation<E>;
  closePreview: (input: {
    environmentId: EnvironmentId;
    input: PreviewCloseInput;
  }) => Promise<unknown>;
}) {
  await ensureClientSettingsHydrated();
  if (!isElectron || !getClientSettings().linearViewEnabled) {
    throw new Error("Enable Linear view in Settings → Features in the desktop app.");
  }
  const existing = Object.values(readThreadPreviewState(input.threadRef).sessions).find(
    (session) => session.surface === "linear",
  );
  if (existing && !input.url) {
    useRightPanelStore.getState().openBrowser(input.threadRef, existing.tabId);
    return existing.tabId;
  }
  const url = input.url ?? linearInitialUrl(input.workspace, input.branch);
  if (input.url) {
    const target = new URL(input.url);
    if (
      target.origin !== "https://linear.app" ||
      target.pathname.split("/")[1] !== input.workspace ||
      target.username ||
      target.password
    ) {
      throw new Error("Choose an issue in this project's configured Linear workspace.");
    }
  }
  const result = await openPreviewSession({
    threadRef: input.threadRef,
    openPreview: input.openPreview,
    surface: "linear",
    viewport: FILL_PREVIEW_VIEWPORT,
    ...(url ? { url } : {}),
  });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  if (result.value.surface !== "linear" || !getClientSettings().linearViewEnabled) {
    beginPreviewSessionClose(input.threadRef, result.value.tabId);
    await input.closePreview({
      environmentId: input.threadRef.environmentId,
      input: { threadId: input.threadRef.threadId, tabId: result.value.tabId },
    });
    throw new Error(
      result.value.surface !== "linear"
        ? "Update this environment's server to use Linear view."
        : "Linear view was disabled.",
    );
  }
  useRightPanelStore.getState().openBrowser(input.threadRef, result.value.tabId);
  return result.value.tabId;
}
