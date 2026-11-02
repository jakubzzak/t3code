import type { ClientSettings } from "@t3tools/contracts";
import type { ElectronThermalState } from "../electron/ElectronPowerMonitor.ts";

export interface BatteryReading {
  readonly percent: number | null;
  readonly onBattery: boolean;
}

/** Always-awake policy adapted from Joel Wohlhauser's Blackbird (MIT). */
export function decideAwake(
  settings: Pick<
    ClientSettings,
    "awakeLowPowerBelowPercent" | "awakeSleepBelowPercent" | "awakeHeatRules"
  >,
  battery: BatteryReading | null,
  thermal: ElectronThermalState,
) {
  if (settings.awakeLowPowerBelowPercent < settings.awakeSleepBelowPercent) {
    return {
      active: false,
      lowPower: false,
      message: "The Low Power Mode threshold must be at least the sleep threshold.",
    };
  }
  if (battery === null || (battery.onBattery && battery.percent === null)) {
    return {
      active: false,
      lowPower: false,
      message: "Cannot read the battery. Normal sleep is allowed.",
    };
  }
  const percent = battery.onBattery ? battery.percent : null;
  if (percent !== null && percent < settings.awakeSleepBelowPercent) {
    return {
      active: false,
      lowPower: false,
      message: `Battery at ${percent}%. Normal sleep is allowed below ${settings.awakeSleepBelowPercent}%.`,
    };
  }
  if (settings.awakeHeatRules && (thermal === "critical" || thermal === "unknown")) {
    return {
      active: false,
      lowPower: false,
      message:
        thermal === "critical"
          ? "The Mac is critically hot. Normal sleep is allowed."
          : "Cannot read thermal state. Normal sleep is allowed.",
    };
  }
  return {
    active: true,
    lowPower:
      (settings.awakeHeatRules && thermal === "serious") ||
      (percent !== null && percent < settings.awakeLowPowerBelowPercent),
    message: null,
  };
}

export function parseBattery(output: string): BatteryReading | null {
  const source = /Now drawing from '(AC Power|Battery Power)'/.exec(output)?.[1];
  if (source === undefined) return null;
  const match = /InternalBattery[^\n]*?(\d+)%/.exec(output)?.[1];
  const percent = match === undefined ? null : Number(match);
  if (percent !== null && (percent < 0 || percent > 100)) return null;
  return { percent, onBattery: source === "Battery Power" };
}

export function parseLidClosed(output: string): boolean | null {
  const state = /"AppleClamshellState" = (Yes|No)/.exec(output)?.[1];
  return state === undefined ? null : state === "Yes";
}
