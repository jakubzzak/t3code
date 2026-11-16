import { requestLinear } from "./requestLinear";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useThreadShell } from "~/state/entities";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { lazy, Suspense, useEffect, useState } from "react";
import { createLinearLoginAssist } from "~/browser/linearLogin";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { previewBridge } from "../preview/previewBridge";

const AccountEmail = lazy(() => import("../clerk/LinearAccountEmail"));

export function LinearLoginAssist(props: {
  runtimeTabId: string;
  threadRef: ScopedThreadRef;
  url: string | null;
  loading: boolean;
}) {
  const thread = useThreadShell(props.threadRef);
  const projectId = thread?.projectId;
  const environmentId = props.threadRef.environmentId;
  const settings = useEnvironmentSettings(environmentId);
  const workspace = resolveProjectSettings(settings, projectId ?? null).settings.linearWorkspace;
  const connection =
    workspace && projectId
      ? {
          workspace,
          connectionKey: JSON.stringify([environmentId, projectId]),
        }
      : undefined;
  if (!projectId) return null;
  // Keyed on the tab so the login steps start fresh for each guest.
  return hasCloudPublicConfig() ? (
    <Suspense fallback={null}>
      <AccountEmail key={props.runtimeTabId} {...props} connection={connection} />
    </Suspense>
  ) : (
    <LinearLoginSteps key={props.runtimeTabId} {...props} connection={connection} email="" />
  );
}

export interface LinearLoginStepsProps {
  runtimeTabId: string;
  url: string | null;
  loading: boolean;
  email: string;
  connection?: { workspace: string; connectionKey: string } | undefined;
}

export function LinearLoginSteps({
  runtimeTabId,
  url,
  loading,
  email,
  connection,
}: LinearLoginStepsProps) {
  // The assist remembers which login steps it already tried; callers key this on runtimeTabId.
  const [assist] = useState(() =>
    previewBridge ? createLinearLoginAssist(previewBridge.automation, runtimeTabId) : null,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the Linear login page in the guest browser as its URL changes
  useEffect(() => {
    if (!url || loading || !assist) return;
    let current = true;
    void (async () => {
      let resolvedEmail = email;
      const request = requestLinear;
      if (connection && request && url.startsWith("https://accounts.google.com/")) {
        try {
          const status = await request({ operation: "status", ...connection });
          resolvedEmail = status.connection?.email ?? email;
        } catch {
          // A locked or unavailable credential store must not prevent manual panel login.
        }
      }
      if (current) await assist(url, resolvedEmail);
    })();
    return () => {
      current = false;
    };
  }, [assist, connection, email, loading, url]);
  return null;
}
