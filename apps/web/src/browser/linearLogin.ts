import type { DesktopPreviewBridge } from "@t3tools/contracts";

/** One attempt per login flow; navigation events advance the two allowed steps. */
export function createLinearLoginAssist(
  automation: DesktopPreviewBridge["automation"],
  tabId: string,
) {
  let googleStarted = false;
  let emailAttempted = false;
  let loginAttempted = false;
  return async (rawUrl: string, email: string) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return;
    }
    if (url.protocol !== "https:") return;
    if (
      url.hostname === "linear.app" &&
      url.pathname !== "/login" &&
      !url.pathname.startsWith("/auth/")
    ) {
      loginAttempted = false;
      googleStarted = false;
      emailAttempted = false;
      return;
    }
    try {
      if (url.hostname === "linear.app" && url.pathname === "/login" && !loginAttempted) {
        loginAttempted = true;
        // Mark the flow before clicking: Google may report navigation before click returns.
        googleStarted = true;
        await automation.click(tabId, {
          locator: 'role=button[name="Continue with Google"]',
          timeoutMs: 1500,
        });
      } else if (
        googleStarted &&
        !emailAttempted &&
        email.trim() &&
        url.hostname === "accounts.google.com" &&
        /\/signin\/(?:identifier|v2\/identifier)$/.test(url.pathname)
      ) {
        emailAttempted = true;
        await automation.waitFor(tabId, { locator: 'input[type="email"]', timeoutMs: 1500 });
        const existing = await automation.evaluate(tabId, {
          expression: "document.querySelector('input[type=\"email\"]')?.value",
        });
        if (existing !== "") return;
        await automation.type(tabId, {
          locator: 'input[type="email"]',
          text: email.trim(),
          timeoutMs: 1500,
        });
        await automation.click(tabId, { locator: 'role=button[name="Next"]', timeoutMs: 1500 });
      }
    } catch {
      googleStarted = false;
      emailAttempted = true;
    }
  };
}
