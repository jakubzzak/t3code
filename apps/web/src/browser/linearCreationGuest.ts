/** Runs in Linear's document. Only a submission from the editor we open can complete it.
 * Linear currently sends issueCreate over XHR with a client-generated UUID. Keep this
 * adapter fail-closed if their editor or mutation protocol changes; never infer creation
 * from navigation, a toast, or the newest issue in the workspace.
 */
export function installLinearCreationGuest(token: string, workspace: string) {
  type Result = {
    status: "pending" | "cancelled" | "created" | "error";
    issueId?: string;
    message?: string;
  };
  type Guest = { token: string; result: Result; cancel: () => void };
  const host = window as Window & { __t3LinearCreation?: Guest };
  if (location.origin !== "https://linear.app" || location.pathname.split("/")[1] !== workspace)
    throw new Error("Sign in to this project's Linear workspace, then try Create issue again.");
  if (document.querySelector('[aria-label="Issue title"]'))
    throw new Error("Finish or cancel the open Linear issue editor before creating another issue.");
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="Create new issue"]');
  if (!button || button.disabled)
    throw new Error("Linear's issue editor is unavailable. Try again after signing in.");
  host.__t3LinearCreation?.cancel();
  const guest: Guest = {
    token,
    result: { status: "pending" },
    cancel: () => finish({ status: "cancelled" }),
  };
  host.__t3LinearCreation = guest;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const urls = new WeakMap<XMLHttpRequest, string>();
  let dialog: Element | null = null;
  let submittedTitle: string | null = null;
  let candidateId: string | null = null;
  const finish = (result: Result) => {
    if (guest.result.status !== "pending") return;
    guest.result = result;
    observer.disconnect();
    document.removeEventListener("submit", submit, true);
    clearTimeout(deadline);
    if (XMLHttpRequest.prototype.open === open) XMLHttpRequest.prototype.open = originalOpen;
    if (XMLHttpRequest.prototype.send === send) XMLHttpRequest.prototype.send = originalSend;
  };
  const submit = (event: Event) => {
    if (!dialog || !(event.target instanceof Node) || !dialog.contains(event.target)) return;
    submittedTitle =
      dialog.querySelector('[aria-label="Issue title"]')?.textContent?.trim() || null;
  };
  const optimisticIssueId = () => {
    if (!submittedTitle) return null;
    for (const notice of document.querySelectorAll('[role="status"]')) {
      if (!notice.textContent?.includes("Issue created")) continue;
      for (const link of notice.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        if (!link.textContent?.trim().endsWith(submittedTitle)) continue;
        const url = new URL(link.href);
        const parts = url.pathname.split("/");
        if (url.origin === "https://linear.app" && parts[1] === workspace && parts[2] === "issue")
          return parts[3] ?? null;
      }
    }
    return null;
  };
  const observer = new MutationObserver(() => {
    if (!dialog)
      dialog =
        document.querySelector('[aria-label="Issue title"]')?.closest('[role="dialog"]') ?? null;
    if (dialog && !dialog.isConnected && !candidateId && !optimisticIssueId())
      finish({ status: "cancelled" });
  });
  const deadline = setTimeout(
    () =>
      finish({
        status: "error",
        message: "Linear issue creation timed out. Your issue or draft remains in Linear.",
      }),
    15 * 60_000,
  );
  function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async = true,
    username?: string | null,
    password?: string | null,
  ) {
    urls.set(this, String(url));
    originalOpen.call(this, method, url, async, username, password);
  }
  function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      if (
        guest.result.status === "pending" &&
        submittedTitle &&
        typeof body === "string" &&
        body.length < 1_000_000 &&
        urls.get(this) === "https://client-api.linear.app/graphql"
      ) {
        const payload = JSON.parse(body);
        const query = typeof payload.query === "string" ? payload.query : "";
        const match =
          /\b(?:([_A-Za-z]\w*)\s*:\s*)?issueCreate\s*\(\s*input\s*:\s*\$([_A-Za-z]\w*)\s*\)/.exec(
            query,
          );
        const input = match ? payload.variables?.[match[2]!] : null;
        if (
          /^\s*mutation\b/.test(query) &&
          match &&
          input?.title === submittedTitle &&
          (dialog?.isConnected || optimisticIssueId() === input.id) &&
          typeof input.id === "string" &&
          /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.id) &&
          (!candidateId || candidateId === input.id)
        ) {
          candidateId = input.id;
          const issueId = input.id as string;
          const field = match[1] ?? "issueCreate";
          this.addEventListener(
            "load",
            async () => {
              try {
                const response =
                  this.responseType === "json"
                    ? this.response
                    : JSON.parse(
                        this.response instanceof Blob
                          ? await this.response.text()
                          : this.response instanceof ArrayBuffer
                            ? new TextDecoder().decode(this.response)
                            : this.responseText,
                      );
                if (
                  this.status >= 200 &&
                  this.status < 300 &&
                  !response.errors?.length &&
                  response.data?.[field]?.lastSyncId != null
                )
                  finish({ status: "created", issueId });
                else
                  finish({
                    status: "error",
                    message: "Linear could not create the issue. Check the editor and try again.",
                  });
              } catch {
                finish({
                  status: "error",
                  message:
                    "Linear returned an unrecognized creation response. The chat has not changed.",
                });
              }
            },
            { once: true },
          );
          this.addEventListener(
            "error",
            () =>
              finish({
                status: "error",
                message: "Linear issue creation failed. Check your connection and try again.",
              }),
            { once: true },
          );
        }
      }
    } catch {
      // Unrelated requests must retain their original behavior.
    }
    originalSend.call(this, body);
  }
  XMLHttpRequest.prototype.open = open;
  XMLHttpRequest.prototype.send = send;
  document.addEventListener("submit", submit, true);
  observer.observe(document.body, { subtree: true, childList: true });
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  return true;
}
