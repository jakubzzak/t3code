import { describe, expect, it } from "vite-plus/test";
import { integrationDisabledReason } from "./integrationAvailability";

describe("project integration availability", () => {
  it("requires one explicit project instead of the general/environment view", () => {
    expect(integrationDisabledReason(false, 0)).toBe("Select a project above.");
    expect(integrationDisabledReason(true, 0)).toContain("one project checkout");
    expect(integrationDisabledReason(true, 2)).toContain("one project checkout");
  });
  it("allows project connection setup independently of feature switches", () => {
    expect(integrationDisabledReason(true, 1)).toBeNull();
  });
});
