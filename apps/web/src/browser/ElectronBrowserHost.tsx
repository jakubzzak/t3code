"use client";

import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { AuthPreviewOperateScope, FILL_PREVIEW_VIEWPORT } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Fragment, type ComponentProps, useEffect, useMemo, useRef, useState } from "react";

import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { LinearLoginAssist } from "~/components/linear/LinearLoginAssist";

import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { useActivePreviewSessions, beginPreviewSessionClose } from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserDefaults } from "./browserDefaults";
import { useBrowserPointerStore } from "./browserPointerStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { openUrlInPreview } from "./openFileInPreview";
import { rendersServerTabNatively } from "./previewRuntime";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

export function ElectronBrowserHost() {
  const { resolvedTheme } = useTheme();
  const closePreview = useAtomCommand(previewEnvironment.close, "close Linear view");
  const linearEnabled = useClientSettings((settings) => settings.linearViewEnabled);
  const settingsHydrated = useClientSettingsHydrated();
  const previewByThreadKey = useActivePreviewSessions();
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const sessions = useMemo(
    () =>
      Object.entries(previewByThreadKey).flatMap(([threadKey, previewState]) => {
        const threadRef = parseScopedThreadKey(threadKey);
        // Server tabs of other environments stream; this desktop's own server tabs render here.
        return threadRef
          ? Object.values(previewState.sessions)
              .filter(
                (snapshot) =>
                  snapshot.runtime !== "server" ||
                  rendersServerTabNatively(threadRef.environmentId, primaryEnvironmentId, snapshot),
              )
              .map((snapshot) => ({
                hasWebContents:
                  previewState.desktopByTabId[snapshot.tabId]?.hasWebContents ?? false,
                threadRef,
                snapshot,
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
    [previewByThreadKey, primaryEnvironmentId],
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

  // A `target="_blank"` link inside a hosted page opens as another tab of the
  // same thread, so the page that held the link stays where it is.
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: true });
  const sessionByRuntimeTabId = useRef(new Map<string, (typeof sessions)[number]>());
  useEffect(() => {
    sessionByRuntimeTabId.current = new Map(
      sessions.map((session) => [session.runtimeTabId, session]),
    );
  }, [sessions]);
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onOpenLink(({ tabId, url, background }) => {
      const source = sessionByRuntimeTabId.current.get(tabId);
      if (!source) return;
      // The new tab keeps the source tab's profile so its cookies carry over.
      void openUrlInPreview({
        threadRef: source.threadRef,
        url,
        openPreview,
        profileId: source.snapshot.profileId,
        background,
      });
    });
  }, [openPreview]);

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
              <AuthorizedBrowserWebview
                key={runtimeTabId}
                threadRef={threadRef}
                tabId={snapshot.tabId}
                runtimeTabId={runtimeTabId}
                initialUrl={url}
                surface={snapshot.surface}
                viewport={snapshot.viewport ?? FILL_PREVIEW_VIEWPORT}
                pictureInPicture={pictureInPicture}
                profileId={snapshot.profileId}
                zoomFactor={zoomFactor}
                serverDriven={snapshot.runtime === "server"}
                {...(snapshot.runtime === "server"
                  ? {
                      serverRendering: {
                        colorScheme: snapshot.colorScheme ?? "system",
                        zoomFactor: snapshot.zoomFactor ?? 1,
                      },
                    }
                  : {})}
              />
            </Fragment>
          );
        })}
    </div>
  );
}

function AuthorizedBrowserWebview(props: ComponentProps<typeof HostedBrowserWebview>) {
  const canOperatePreview = useEnvironmentScope(
    props.threadRef.environmentId,
    AuthPreviewOperateScope,
  );
  const profileId = useTabProfileId(props.profileId);
  return canOperatePreview ? <HostedBrowserWebview {...props} profileId={profileId} /> : null;
}

/**
 * Agent `preview_open` normally carries the profile clients reported (see
 * BrowserProfileReporter). An agent tab opened before any client reported has
 * none, so it falls back to the configured default here. It is latched once
 * settings load: Electron fixes the partition when the guest attaches, so a
 * later settings change must not move a live tab.
 */
function useTabProfileId(profileId: string | undefined): string | undefined {
  const hydrated = useClientSettingsHydrated();
  const defaultProfileId = useBrowserDefaults().profileId;
  const [fallback, setFallback] = useState<string | undefined>(undefined);
  if (profileId === undefined && hydrated && fallback === undefined) {
    setFallback(defaultProfileId);
  }
  return profileId ?? fallback;
}
