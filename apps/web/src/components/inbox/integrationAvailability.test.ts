import { describe, expect, it } from "vite-plus/test";
import { integrationDisabledReason } from "./integrationAvailability";

const off = { inboxEnabled: false, linearViewEnabled: false };
describe("project integration availability", () => {
  it("never enables a general/environment view, even if its defaults are on", () => {
    for (const source of ["linear", "slack", "superhuman"] as const) {
      expect(
        integrationDisabledReason(source, false, 0, {
          inboxEnabled: true,
          linearViewEnabled: true,
        }),
      ).toContain("Select a project");
      expect(
        integrationDisabledReason(source, true, 2, { inboxEnabled: true, linearViewEnabled: true }),
      ).toContain("one project checkout");
    }
  });
  it("requires project feature opt-in and keeps Linear view independent of Inbox", () => {
    for (const source of ["linear", "slack", "superhuman"] as const)
      expect(integrationDisabledReason(source, true, 1, off)).toContain("Enable");
    expect(
      integrationDisabledReason("linear", true, 1, { ...off, linearViewEnabled: true }),
    ).toBeNull();
    expect(integrationDisabledReason("linear", true, 1, { ...off, inboxEnabled: true })).toBeNull();
    for (const source of ["slack", "superhuman"] as const) {
      expect(
        integrationDisabledReason(source, true, 1, { ...off, linearViewEnabled: true }),
      ).toContain("Enable Inbox");
      expect(integrationDisabledReason(source, true, 1, { ...off, inboxEnabled: true })).toBeNull();
    }
  });
});
