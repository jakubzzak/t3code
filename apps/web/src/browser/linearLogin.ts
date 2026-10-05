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
        const clicked = await automation.evaluate(tabId, {
          expression: `(() => {
            if (location.origin !== "https://linear.app" || location.pathname !== "/login" || location.href !== ${JSON.stringify(rawUrl)}) return false;
            const button = [...document.querySelectorAll('button, [role="button"]')].find(element => element.textContent?.trim() === "Continue with Google");
            if (!button || button.disabled) return false;
            button.click();
            return true;
          })()`,
        });
        if (clicked !== true) googleStarted = false;
      } else if (
        googleStarted &&
        !emailAttempted &&
        email.trim() &&
        url.hostname === "accounts.google.com" &&
        /\/signin\/(?:identifier|v2\/identifier)$/.test(url.pathname)
      ) {
        emailAttempted = true;
        await automation.waitFor(tabId, { locator: 'input[type="email"]', timeoutMs: 1500 });
        // The origin, form state, fill and submit are one synchronous operation
        // in one document. A navigation during waitFor cannot redirect the email.
        await automation.evaluate(tabId, {
          expression: `(() => {
            if (location.origin !== "https://accounts.google.com" || location.href !== ${JSON.stringify(rawUrl)} || !/\\/signin\\/(?:identifier|v2\\/identifier)$/.test(location.pathname)) return false;
            const input = document.querySelector('input[type="email"]');
            const next = [...document.querySelectorAll('button, [role="button"]')].find(element => element.textContent?.trim() === "Next");
            if (!(input instanceof HTMLInputElement) || input.value !== "" || input.disabled || input.readOnly || !next || next.disabled) return false;
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            if (!setValue) return false;
            setValue.call(input, ${JSON.stringify(email.trim())});
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            next.click();
            return true;
          })()`,
        });
      }
    } catch {
      googleStarted = false;
      emailAttempted = true;
    }
  };
}
