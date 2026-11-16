import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { DesktopAwakeState, DesktopEnvironmentBootstrapSchema } from "./ipc.ts";

describe("DesktopEnvironmentBootstrapSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopEnvironmentBootstrapSchema);

  it("preserves the concrete running distro separately from the backend id", () => {
    expect(
      decode({
        id: "wsl:default",
        label: "WSL (Ubuntu)",
        runningDistro: "Ubuntu",
        httpBaseUrl: "http://127.0.0.1:3774/",
        wsBaseUrl: "ws://127.0.0.1:3774/",
      }),
    ).toEqual({
      id: "wsl:default",
      label: "WSL (Ubuntu)",
      runningDistro: "Ubuntu",
      httpBaseUrl: "http://127.0.0.1:3774/",
      wsBaseUrl: "ws://127.0.0.1:3774/",
    });
  });

  it("allows non-running and non-WSL bootstraps to report no running distro", () => {
    expect(
      decode({
        id: "primary",
        label: "Windows",
        runningDistro: null,
        httpBaseUrl: null,
        wsBaseUrl: null,
      }).runningDistro,
    ).toBeNull();
  });
});

describe("DesktopAwakeState hotspot compatibility", () => {
  const decode = Schema.decodeUnknownSync(DesktopAwakeState);
  const oldState = {
    supported: true,
    installed: true,
    status: "active",
    lowPower: false,
    message: null,
  };

  it("keeps an older desktop's missing capability distinguishable from an idle helper", () => {
    expect(decode(oldState)).not.toHaveProperty("hotspotMessage");
    expect(decode({ ...oldState, hotspotMessage: null }).hotspotMessage).toBeNull();
  });

  it("preserves hotspot status separately from power safeguards", () => {
    expect(
      decode({
        ...oldState,
        status: "paused",
        message: "Battery is low.",
        hotspotMessage: "Allow Location Services for Blackbird Hotspot.",
      }),
    ).toMatchObject({
      message: "Battery is low.",
      hotspotMessage: "Allow Location Services for Blackbird Hotspot.",
    });
  });
});
