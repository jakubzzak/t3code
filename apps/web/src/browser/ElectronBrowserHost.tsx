"use client";

import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { FILL_PREVIEW_VIEWPORT } from "@t3tools/contracts";
import { Fragment, useEffect, useMemo } from "react";
import { LinearLoginAssist } from "~/components/linear/LinearLoginAssist";

import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { useActivePreviewSessions, beginPreviewSessionClose } from "~/previewStateStore";
import { useClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserPointerStore } from "./browserPointerStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

export function ElectronBrowserHost() {
  const { resolvedTheme } = useTheme();
  const closePreview = useAtomCommand(previewEnvironment.close, "close Linear view");
  const linearEnabled = useClientSettings((settings) => settings.linearViewEnabled);
  const settingsHydrated = useClientSettingsHydrated();
  const previewByThreadKey = useActivePreviewSessions();
  const sessions = useMemo(
    () =>
      Object.entries(previewByThreadKey).flatMap(([threadKey, previewState]) => {
        const threadRef = parseScopedThreadKey(threadKey);
        return threadRef
          ? Object.values(previewState.sessions).map((snapshot) => ({
              threadRef,
              snapshot,
              hasWebContents: previewState.desktopByTabId[snapshot.tabId]?.hasWebContents ?? false,
              runtimeTabId: previewRuntimeTabId(
                threadRef,
                previewState.serverEpoch,
                snapshot.tabId,
              ),
              pictureInPicture:
                previewState.desktopByTabId[snapshot.tabId]?.pictureInPicture ?? false,
              zoomFactor: previewState.desktopByTabId[snapshot.tabId]?.zoomFactor ?? 1,
            }))
          : [];
      }),
    [previewByThreadKey],
  );

  useEffect(() => {
    if (!settingsHydrated || (isElectron && linearEnabled)) return;
    for (const { threadRef, snapshot, runtimeTabId, hasWebContents } of sessions) {
      if (snapshot.surface !== "linear") continue;
      useRightPanelStore.getState().closeSurface(threadRef, `browser:${snapshot.tabId}`);
      const miniPlayer = usePreviewMiniPlayerStore.getState();
      const source = miniPlayer.byThreadKey[scopedThreadKey(threadRef)]?.source;
      if (source?.kind === "browser" && source.tabId === snapshot.tabId)
        miniPlayer.close(threadRef);
      beginPreviewSessionClose(threadRef, snapshot.tabId);
      void window.desktopBridge?.preview?.closeTab(runtimeTabId).catch(() => undefined);
      // Do not close a session owned by another desktop that has the feature enabled.
      if (hasWebContents)
        void closePreview({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, tabId: snapshot.tabId },
        });
    }
  }, [closePreview, linearEnabled, sessions, settingsHydrated]);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;

    let lastSerializedTheme = "";
    const syncTheme = () => {
      const theme = readPreviewAnnotationTheme();
      const serializedTheme = JSON.stringify(theme);
      if (serializedTheme === lastSerializedTheme) return;
      lastSerializedTheme = serializedTheme;
      void preview.setAnnotationTheme(theme).catch(() => {
        lastSerializedTheme = "";
      });
    };
    const frameId = window.requestAnimationFrame(syncTheme);
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const headObserver = new MutationObserver(syncTheme);
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      headObserver.disconnect();
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onPointerEvent((event) => {
      useBrowserPointerStore.getState().apply(event);
    });
  }, []);

  if (!isElectron) return null;
  return (
    <div className="contents" data-electron-browser-host>
      {sessions
        .filter(
          ({ snapshot }) => snapshot.surface !== "linear" || (settingsHydrated && linearEnabled),
        )
        .map(({ threadRef, snapshot, runtimeTabId, pictureInPicture, zoomFactor }) => {
          const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
          return (
            <Fragment key={runtimeTabId}>
              {snapshot.surface === "linear" && (
                <LinearLoginAssist
                  runtimeTabId={runtimeTabId}
                  threadRef={threadRef}
                  url={url}
                  loading={snapshot.navStatus._tag !== "Success"}
                />
              )}
              <HostedBrowserWebview
                threadRef={threadRef}
                tabId={snapshot.tabId}
                runtimeTabId={runtimeTabId}
                initialUrl={url}
                surface={snapshot.surface}
                viewport={snapshot.viewport ?? FILL_PREVIEW_VIEWPORT}
                pictureInPicture={pictureInPicture}
                profileId={snapshot.profileId}
                zoomFactor={zoomFactor}
              />
            </Fragment>
          );
        })}
    </div>
  );
}
