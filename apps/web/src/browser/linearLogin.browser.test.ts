import type { DesktopPreviewBridge } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { createLinearLoginAssist } from "./linearLogin";

const googleUrl = "https://accounts.google.com/v3/signin/identifier";

/**
 * Mounts a Linear/Google login form and evaluates injected expressions against it with a fake
 * `location`, since the test page cannot change its own origin. Dispose removes the form.
 */
function fixture() {
  using stack = new DisposableStack();
  const root = stack.adopt(document.createElement("div"), (node) => node.remove());
  root.innerHTML = '<button>Continue with Google</button><input type="email"><button>Next</button>';
  document.body.append(root);
  let location = new URL("https://linear.app/login");
  const navigate = (url: string) => {
    location = new URL(url);
  };
  const clicked: string[] = [];
  for (const button of root.querySelectorAll("button")) {
    button.addEventListener("click", () => clicked.push(button.textContent ?? ""));
  }
  const automation = {
    status: vi.fn(),
    press: vi.fn(),
    waitFor: vi.fn(async () => {}),
    evaluate: vi.fn(async (_tab: string, input: { expression: string }) => {
      const evaluate = new Function(
        "location",
        "document",
        "HTMLInputElement",
        "Event",
        `return (${input.expression});`,
      );
      return evaluate(location, document, HTMLInputElement, Event) as unknown;
    }),
  } satisfies DesktopPreviewBridge["automation"];
  const input = root.querySelector("input")!;
  const resources = stack.move();
  return {
    navigate,
    href: () => location.href,
    input,
    automation,
    clicked,
    assist: createLinearLoginAssist(automation, "tab"),
    [Symbol.dispose]: () => resources.dispose(),
  };
}

describe("Linear login assistance", () => {
  it("fills and submits the Google identifier once, leaving challenges manual", async () => {
    using page = fixture();
    await page.assist("https://linear.app/login", "work@example.com");
    await page.assist("https://linear.app/login", "work@example.com");
    page.navigate(googleUrl);
    await page.assist(googleUrl, "work@example.com");
    await page.assist(googleUrl, "work@example.com");
    page.navigate("https://accounts.google.com/v3/signin/challenge/pwd");
    await page.assist(page.href(), "work@example.com");
    expect(page.input.value).toBe("work@example.com");
    expect(page.clicked).toEqual(["Continue with Google", "Next"]);
  });
  it("does not fill an unrelated Google session or overwrite manual input", async () => {
    using page = fixture();
    page.navigate(googleUrl);
    await page.assist(googleUrl, "work@example.com");
    expect(page.input.value).toBe("");
    page.navigate("https://linear.app/login");
    await page.assist(page.href(), "work@example.com");
    page.input.value = "someone@example.com";
    page.navigate(googleUrl);
    await page.assist(googleUrl, "work@example.com");
    expect(page.input.value).toBe("someone@example.com");
    expect(page.clicked).toEqual(["Continue with Google"]);
  });
  it.each([
    "https://untrusted.example/",
    "https://accounts.google.com.evil.test/v3/signin/identifier",
    "https://accounts.google.com:444/v3/signin/identifier",
    "https://linear.app/login",
    "https://accounts.google.com/v3/signin/challenge/pwd",
  ])("does not leak email or submit when waitFor navigates to %s", async (url) => {
    using page = fixture();
    await page.assist("https://linear.app/login", "private@example.com");
    page.navigate(googleUrl);
    page.automation.waitFor.mockImplementation(async () => {
      page.navigate(url);
    });
    await page.assist(googleUrl, "private@example.com");
    expect(page.input.value).toBe("");
    expect(page.clicked).toEqual(["Continue with Google"]);
  });
  it("does not click Continue on a stale Linear URL", async () => {
    using page = fixture();
    page.navigate("https://untrusted.example");
    await page.assist("https://linear.app/login", "private@example.com");
    expect(page.clicked).toEqual([]);
  });
  it("abandons a failed attempt without retries or surfacing the error", async () => {
    using page = fixture();
    page.automation.evaluate.mockRejectedValue(new Error("not found"));
    await expect(
      page.assist("https://linear.app/login", "work@example.com"),
    ).resolves.toBeUndefined();
    await page.assist("https://linear.app/login", "work@example.com");
    expect(page.automation.evaluate).toHaveBeenCalledTimes(1);
  });
  it("leaves email manual when absent", async () => {
    using page = fixture();
    await page.assist("https://linear.app/login", "");
    page.navigate(googleUrl);
    await page.assist(googleUrl, "");
    expect(page.input.value).toBe("");
    expect(page.clicked).toEqual(["Continue with Google"]);
  });
});
