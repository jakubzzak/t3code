/** Hotspot retry/return policy adapted from Joel Wohlhauser's Blackbird (MIT). */
export const HOTSPOT_TICK = "5 seconds";
export const IPHONE_HOTSPOT_GATEWAY = "172.20.10.1";
export const RETURN_CHECK_MS = 30_000;
const RETRY_DROPPED_NETWORK_MS = 10 * 60_000;

export interface HotspotStay {
  readonly name: string;
  readonly since: number;
  readonly knownAtJoin: ReadonlyArray<string>;
}

export function retryDelay(attempts: number): number {
  return [5_000, 10_000, 20_000, 30_000][Math.min(Math.max(attempts - 1, 0), 3)]!;
}

export function returnCandidate(stay: HotspotStay, known: ReadonlyArray<string>, now: number) {
  const candidates = known.filter((name) => name !== stay.name);
  return (
    candidates.find((name) => !stay.knownAtJoin.includes(name)) ??
    (now - stay.since >= RETRY_DROPPED_NETWORK_MS ? candidates[0] : undefined)
  );
}

export const parseWifiDevice = (output: string): string | null =>
  /Hardware Port: Wi-Fi\s*\n\s*Device: (\S+)/.exec(output)?.[1] ?? null;

export const parseDefaultGateway = (output: string): string | null =>
  /gateway: (\S+)/.exec(output)?.[1] ?? null;

export const parseKnownNetworks = (output: string): ReadonlyArray<string> =>
  output
    .split("\n")
    .filter((line) => line.startsWith("\t"))
    .map((line) => line.slice(1))
    .filter(Boolean);
