import type { DesktopPreviewBridge } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { createLinearLoginAssist } from "./linearLogin";

function fixture() {
  const actions: string[] = [];
  const automation = {
    status: vi.fn(),
    snapshot: vi.fn(),
    press: vi.fn(),
    scroll: vi.fn(),
    waitFor: vi.fn(),
    evaluate: vi.fn(async () => ""),
    click: vi.fn(async (_tab, input) => {
      actions.push(`click:${input.locator}`);
    }),
    type: vi.fn(async (_tab, input) => {
      actions.push(`email:${input.text}`);
    }),
  } satisfies DesktopPreviewBridge["automation"];
  return { automation, actions, assist: createLinearLoginAssist(automation, "tab") };
}

describe("Linear login assistance", () => {
  it("advances only the requested Google email step, once per flow", async () => {
    const { assist, actions } = fixture();
    await assist("https://linear.app/login", "work@example.com");
    await assist("https://linear.app/login", "work@example.com");
    await assist("https://accounts.google.com/v3/signin/identifier", "work@example.com");
    await assist("https://accounts.google.com/v3/signin/identifier", "work@example.com");
    await assist("https://accounts.google.com/v3/signin/challenge/pwd", "work@example.com");
    expect(actions).toEqual([
      'click:role=button[name="Continue with Google"]',
      "email:work@example.com",
      'click:role=button[name="Next"]',
    ]);
  });
  it("does not fill an unrelated Google session or overwrite manual input", async () => {
    const { assist, automation, actions } = fixture();
    await assist("https://accounts.google.com/v3/signin/identifier", "work@example.com");
    expect(actions).toEqual([]);
    await assist("https://linear.app/login", "work@example.com");
    automation.evaluate.mockResolvedValue("someone@example.com");
    await assist("https://accounts.google.com/v3/signin/identifier", "work@example.com");
    expect(actions).toHaveLength(1);
  });
  it("abandons a failed attempt without retries or surfacing the error", async () => {
    const { assist, automation } = fixture();
    automation.click.mockRejectedValue(new Error("not found"));
    await expect(assist("https://linear.app/login", "work@example.com")).resolves.toBeUndefined();
    await assist("https://linear.app/login", "work@example.com");
    expect(automation.click).toHaveBeenCalledTimes(1);
  });
  it("leaves email manual when absent and ignores lookalike domains", async () => {
    const { assist, actions } = fixture();
    await assist("https://linear.app.evil.test/login", "work@example.com");
    expect(actions).toEqual([]);
    await assist("https://linear.app/login", "");
    await assist("https://accounts.google.com/v3/signin/identifier", "");
    expect(actions).toHaveLength(1);
  });
});
