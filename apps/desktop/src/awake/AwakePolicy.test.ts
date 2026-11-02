import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { decideAwake, parseBattery, parseLidClosed } from "./AwakePolicy.ts";

const policy = DEFAULT_CLIENT_SETTINGS;
describe("Keep awake policy", () => {
  it.each([
    [9, false, false],
    [10, true, true],
    [39, true, true],
    [40, true, false],
  ])("applies battery boundaries at %i percent", (percent, active, lowPower) => {
    expect(decideAwake(policy, { percent, onBattery: true }, "nominal")).toMatchObject({
      active,
      lowPower,
    });
  });
  it("uses thermal policy on AC and allows a desktop without a battery", () => {
    const ac = { percent: null, onBattery: false };
    expect(decideAwake(policy, ac, "nominal")).toMatchObject({ active: true, lowPower: false });
    expect(decideAwake(policy, ac, "serious")).toMatchObject({ active: true, lowPower: true });
    expect(decideAwake(policy, ac, "critical").active).toBe(false);
    expect(decideAwake(policy, ac, "unknown").active).toBe(false);
    expect(decideAwake({ ...policy, awakeHeatRules: false }, ac, "critical").active).toBe(true);
  });
  it("pauses on unreadable batteries and invalid threshold ordering", () => {
    expect(decideAwake(policy, null, "nominal").active).toBe(false);
    expect(decideAwake(policy, { percent: null, onBattery: true }, "nominal").active).toBe(false);
    expect(
      decideAwake(
        { ...policy, awakeSleepBelowPercent: 80 },
        { percent: 90, onBattery: true },
        "nominal",
      ).active,
    ).toBe(false);
  });
  it("allows disabling the battery floor", () => {
    expect(
      decideAwake(
        { ...policy, awakeSleepBelowPercent: 0 },
        { percent: 0, onBattery: true },
        "nominal",
      ).active,
    ).toBe(true);
  });
  it("rejects malformed readings instead of treating them as safe", () => {
    expect(
      parseBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 39%; discharging"),
    ).toEqual({ percent: 39, onBattery: true });
    expect(parseBattery("Now drawing from 'AC Power'\n")).toEqual({
      percent: null,
      onBattery: false,
    });
    expect(
      parseBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 999%; discharging"),
    ).toBeNull();
    expect(parseBattery("unrecognized")).toBeNull();
    expect(parseLidClosed('"AppleClamshellState" = Yes')).toBe(true);
    expect(parseLidClosed('"AppleClamshellState" = No')).toBe(false);
    expect(parseLidClosed("unrecognized")).toBeNull();
  });
});
