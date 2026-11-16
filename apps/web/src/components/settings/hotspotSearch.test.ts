import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getSettingsSearchTargetScope, searchSettings } from "./settingsSearch";

const runtime = vi.hoisted(() => ({ desktop: true }));
vi.mock("~/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/env")>()),
  get isElectron() {
    return runtime.desktop;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  runtime.desktop = true;
});

describe("hotspot settings discovery", () => {
  it.each(["hotspot", "iPhone", "reconnect", "Wi-Fi"])(
    "finds hotspot failover by %s on the Mac without a project selection",
    (query) => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      expect(searchSettings(query)).toContainEqual(
        expect.objectContaining({
          id: "awake-hotspot",
          to: "/settings/awake",
        }),
      );
      expect(getSettingsSearchTargetScope("awake-hotspot")?.scope).toBeNull();
    },
  );

  it("does not offer a Mac network control from a web client", () => {
    runtime.desktop = false;
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(searchSettings("hotspot").map((item) => item.id)).not.toContain("awake-hotspot");
  });

  it("does not offer hotspot failover on Windows", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(searchSettings("hotspot").map((item) => item.id)).not.toContain("awake-hotspot");
  });
});
