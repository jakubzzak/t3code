import type { DesktopAwakeState, DesktopBridge } from "@t3tools/contracts";
import { useEffect, useState } from "react";

type AwakeMethods = "getAwakeState" | "setupAwake" | "removeAwake" | "retryAwake" | "onAwakeState";
type AwakeBridge = Required<Pick<DesktopBridge, AwakeMethods>>;

export function getDesktopAwakeBridge(): AwakeBridge | undefined {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  if (
    !bridge?.getAwakeState ||
    !bridge.setupAwake ||
    !bridge.removeAwake ||
    !bridge.retryAwake ||
    !bridge.onAwakeState
  )
    return undefined;
  return {
    getAwakeState: bridge.getAwakeState,
    setupAwake: bridge.setupAwake,
    removeAwake: bridge.removeAwake,
    retryAwake: bridge.retryAwake,
    onAwakeState: bridge.onAwakeState,
  };
}

export function useDesktopAwakeState() {
  const [state, setState] = useState<DesktopAwakeState | null>(null);
  useEffect(() => {
    const bridge = getDesktopAwakeBridge();
    if (!bridge) return;
    let disposed = false;
    let receivedEvent = false;
    const unsubscribe = bridge.onAwakeState((next) => {
      receivedEvent = true;
      setState(next);
    });
    void bridge
      .getAwakeState()
      .then((next) => {
        if (!disposed && !receivedEvent) setState(next);
      })
      .catch(() => {
        if (!disposed && !receivedEvent)
          setState({
            supported: true,
            installed: false,
            status: "error",
            lowPower: false,
            message: "Could not read Keep awake status. Reopen this page to retry.",
          });
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  return [state, setState] as const;
}

export function awakeStatusText(state: DesktopAwakeState | null) {
  if (!state) return "Checking Keep awake…";
  if (state.message) return state.message;
  if (!state.installed) return "Needs one-time setup with your administrator password.";
  if (state.status === "active")
    return state.lowPower
      ? "Keeping this Mac awake in Low Power Mode."
      : "Keeping this Mac awake, including with the lid closed.";
  if (state.status === "starting") return "Starting Keep awake…";
  return "Off. macOS controls when this Mac sleeps.";
}
