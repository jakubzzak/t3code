// @vitest-environment jsdom
import * as NodeVM from "node:vm";
import type { DesktopPreviewBridge } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { createLinearLoginAssist } from "./linearLogin";

const googleUrl = "https://accounts.google.com/v3/signin/identifier";
function fixture() {
  document.body.innerHTML =
    '<button>Continue with Google</button><input type="email"><button>Next</button>';
  let location = new URL("https://linear.app/login");
  const dom = {
    reconfigure: ({ url }: { url: string }) => {
      location = new URL(url);
    },
    window: {
      document,
      get location() {
        return location;
      },
      close: () => document.body.replaceChildren(),
    },
  };
  const clicked: string[] = [];
  for (const button of dom.window.document.querySelectorAll("button")) {
    button.addEventListener("click", () => clicked.push(button.textContent ?? ""));
  }
  const automation = {
    status: vi.fn(),
    snapshot: vi.fn(),
    press: vi.fn(),
    scroll: vi.fn(),
    waitFor: vi.fn(async () => {}),
    evaluate: vi.fn(
      async (_tab: string, input: { expression: string }) =>
        NodeVM.runInNewContext(input.expression, {
          location,
          document,
          HTMLInputElement,
          Event,
        }) as unknown,
    ),
    click: vi.fn(),
    type: vi.fn(),
  } satisfies DesktopPreviewBridge["automation"];
  const input = dom.window.document.querySelector("input")!;
  return { dom, input, automation, clicked, assist: createLinearLoginAssist(automation, "tab") };
}

describe("Linear login assistance", () => {
  it("fills and submits the Google identifier once, leaving challenges manual", async () => {
    const { assist, dom, input, clicked } = fixture();
    await assist("https://linear.app/login", "work@example.com");
    await assist("https://linear.app/login", "work@example.com");
    dom.reconfigure({ url: googleUrl });
    await assist(googleUrl, "work@example.com");
    await assist(googleUrl, "work@example.com");
    dom.reconfigure({ url: "https://accounts.google.com/v3/signin/challenge/pwd" });
    await assist(dom.window.location.href, "work@example.com");
    expect(input.value).toBe("work@example.com");
    expect(clicked).toEqual(["Continue with Google", "Next"]);
    dom.window.close();
  });
  it("does not fill an unrelated Google session or overwrite manual input", async () => {
    const { assist, dom, input, clicked } = fixture();
    dom.reconfigure({ url: googleUrl });
    await assist(googleUrl, "work@example.com");
    expect(input.value).toBe("");
    dom.reconfigure({ url: "https://linear.app/login" });
    await assist(dom.window.location.href, "work@example.com");
    input.value = "someone@example.com";
    dom.reconfigure({ url: googleUrl });
    await assist(googleUrl, "work@example.com");
    expect(input.value).toBe("someone@example.com");
    expect(clicked).toEqual(["Continue with Google"]);
    dom.window.close();
  });
  it.each([
    "https://untrusted.example/",
    "https://accounts.google.com.evil.test/v3/signin/identifier",
    "https://accounts.google.com:444/v3/signin/identifier",
    "https://linear.app/login",
    "https://accounts.google.com/v3/signin/challenge/pwd",
  ])("does not leak email or submit when waitFor navigates to %s", async (url) => {
    const { assist, dom, input, automation, clicked } = fixture();
    await assist("https://linear.app/login", "private@example.com");
    dom.reconfigure({ url: googleUrl });
    automation.waitFor.mockImplementation(async () => {
      dom.reconfigure({ url });
    });
    await assist(googleUrl, "private@example.com");
    expect(input.value).toBe("");
    expect(clicked).toEqual(["Continue with Google"]);
    dom.window.close();
  });
  it("does not click Continue on a stale Linear URL", async () => {
    const { assist, dom, clicked } = fixture();
    dom.reconfigure({ url: "https://untrusted.example" });
    await assist("https://linear.app/login", "private@example.com");
    expect(clicked).toEqual([]);
    dom.window.close();
  });
  it("abandons a failed attempt without retries or surfacing the error", async () => {
    const { assist, automation, dom } = fixture();
    automation.evaluate.mockRejectedValue(new Error("not found"));
    await expect(assist("https://linear.app/login", "work@example.com")).resolves.toBeUndefined();
    await assist("https://linear.app/login", "work@example.com");
    expect(automation.evaluate).toHaveBeenCalledTimes(1);
    dom.window.close();
  });
  it("leaves email manual when absent", async () => {
    const { assist, dom, clicked, input } = fixture();
    await assist("https://linear.app/login", "");
    dom.reconfigure({ url: googleUrl });
    await assist(googleUrl, "");
    expect(input.value).toBe("");
    expect(clicked).toEqual(["Continue with Google"]);
    dom.window.close();
  });
});
