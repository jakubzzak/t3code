import { describe, expect, it } from "vite-plus/test";
import {
  parseDefaultGateway,
  parseKnownNetworks,
  parseWifiDevice,
  retryDelay,
  returnCandidate,
} from "./HotspotPolicy.ts";

describe("hotspot return policy", () => {
  const stay = { name: "iPhone", since: 0, knownAtJoin: ["Train"] };
  it("caps retries, waits ten minutes before retrying failed Wi-Fi, and excludes the hotspot", () => {
    expect([1, 2, 3, 4, 100].map(retryDelay)).toEqual([5_000, 10_000, 20_000, 30_000, 30_000]);
    expect(returnCandidate(stay, ["iPhone"], 600_000)).toBeUndefined();
    expect(returnCandidate(stay, ["Train"], 599_999)).toBeUndefined();
    expect(returnCandidate(stay, ["Train"], 600_000)).toBe("Train");
    expect(returnCandidate(stay, ["Train", "Home"], 1)).toBe("Home");
  });
  it("reads interface, gateway and saved names without trimming valid SSID spaces", () => {
    expect(parseWifiDevice("Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: 00")).toBe("en0");
    expect(parseWifiDevice("Hardware Port: Ethernet\nDevice: en1")).toBeNull();
    expect(parseDefaultGateway("   gateway: 172.20.10.1\n")).toBe("172.20.10.1");
    expect(parseKnownNetworks("Preferred networks on en0:\n\t My Wi-Fi \n\tiPhone\n")).toEqual([
      " My Wi-Fi ",
      "iPhone",
    ]);
  });
});
