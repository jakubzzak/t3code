// @effect-diagnostics nodeBuiltinImport:off - Native loopback OAuth callback with bounded lifetime and AbortController cleanup.
import * as NodeHttp from "node:http";

/** Receives only the registered loopback callback, bound to this authorization's state. */
export async function receiveLinearCallback(input: {
  redirectUri: string;
  authorizationUrl: string;
  state: string;
  signal: AbortSignal;
  openExternal: (url: string) => Promise<boolean>;
}): Promise<string> {
  const redirect = new URL(input.redirectUri);
  if (
    redirect.protocol !== "http:" ||
    redirect.hostname !== "127.0.0.1" ||
    !redirect.port ||
    redirect.search ||
    redirect.hash
  ) {
    throw new Error("Linear OAuth requires a registered http://127.0.0.1:<port>/ callback URL.");
  }
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(300_000)]);
  signal.throwIfAborted();
  const server = NodeHttp.createServer();
  let abort: () => void = () => {};
  try {
    const code = new Promise<string>((resolve, reject) => {
      abort = () => reject(new Error("Linear sign-in was canceled or timed out."));
      signal.addEventListener("abort", abort, { once: true });
      server.on("error", () =>
        reject(
          new Error("Unable to open the Linear callback port. Close another sign-in and retry."),
        ),
      );
      server.on("request", (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Security-Policy", "default-src 'none'");
        let callback: URL;
        try {
          callback = new URL(request.url ?? "/", redirect.origin);
        } catch {
          response.writeHead(400).end("Invalid sign-in callback.");
          return;
        }
        if (
          request.method !== "GET" ||
          callback.pathname !== redirect.pathname ||
          callback.searchParams.get("state") !== input.state
        ) {
          response.writeHead(400).end("Invalid sign-in callback.");
          return;
        }
        const value = callback.searchParams.get("code");
        if (!value || callback.searchParams.has("error")) {
          response.writeHead(400).end("Sign-in was not completed. Return to T3 Code.");
          reject(new Error("Linear authorization was declined."));
          return;
        }
        response
          .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
          .end("Linear authorization received. Return to T3 Code.");
        resolve(value);
      });
      server.listen(Number(redirect.port), "127.0.0.1", () => {
        void input.openExternal(input.authorizationUrl).then(
          (opened) => {
            if (!opened) reject(new Error("Unable to open the browser for Linear sign-in."));
          },
          () => reject(new Error("Unable to open the browser for Linear sign-in.")),
        );
      });
    });
    return await code;
  } finally {
    signal.removeEventListener("abort", abort);
    server.closeAllConnections();
    server.close();
  }
}
