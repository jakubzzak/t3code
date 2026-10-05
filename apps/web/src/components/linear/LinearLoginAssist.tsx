import type { ScopedThreadRef } from "@t3tools/contracts";
import { useThreadShell } from "~/state/entities";
import { linearProjectEmailKey } from "~/browser/linearProjectEmail";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { createLinearLoginAssist } from "~/browser/linearLogin";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { useClientSettings } from "~/hooks/useSettings";
import { previewBridge } from "../preview/previewBridge";

const AccountEmail = lazy(() => import("../clerk/LinearAccountEmail"));

export function LinearLoginAssist(props: {
  runtimeTabId: string;
  threadRef: ScopedThreadRef;
  url: string | null;
  loading: boolean;
}) {
  const thread = useThreadShell(props.threadRef);
  const override = useClientSettings((settings) =>
    thread?.projectId
      ? (settings.linearProjectLoginEmails[
          linearProjectEmailKey({
            environmentId: props.threadRef.environmentId,
            projectId: thread.projectId,
          })
        ] ?? "")
      : "",
  );
  if (!thread?.projectId) return null;
  return hasCloudPublicConfig() && !override ? (
    <Suspense fallback={null}>
      <AccountEmail {...props} />
    </Suspense>
  ) : (
    <LinearLoginSteps {...props} email={override} />
  );
}

export function LinearLoginSteps({
  runtimeTabId,
  url,
  loading,
  email,
}: {
  runtimeTabId: string;
  url: string | null;
  loading: boolean;
  email: string;
}) {
  const assist = useMemo(
    () => (previewBridge ? createLinearLoginAssist(previewBridge.automation, runtimeTabId) : null),
    [runtimeTabId],
  );
  useEffect(() => {
    if (url && !loading) void assist?.(url, email);
  }, [assist, email, loading, url]);
  return null;
}
