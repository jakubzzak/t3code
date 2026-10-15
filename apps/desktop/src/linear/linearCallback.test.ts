// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Exercise the native loopback listener and browser HTTP response directly.
import * as NodeHttp from "node:http";
import { expect, it } from "vite-plus/test";
import { receiveLinearCallback } from "./linearCallback.ts";

async function callbackUri() {
  const reservation = NodeHttp.createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  return `http://127.0.0.1:${address.port}/linear/callback`;
}

it("rejects unrelated callbacks, accepts matching state, and returns a readable browser response", async () => {
  const redirectUri = await callbackUri();
  const response = Promise.withResolvers<Response>();
  const result = await receiveLinearCallback({
    redirectUri,
    state: "expected-state",
    authorizationUrl: "https://linear.app/oauth/authorize",
    signal: new AbortController().signal,
    openExternal: async () => {
      const malformedStatus = await new Promise<number | undefined>((resolve, reject) => {
        const request = NodeHttp.get(redirectUri, { path: "//[" }, (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        });
        request.on("error", reject);
      });
      expect(malformedStatus).toBe(400);
      const invalid = await fetch(`${redirectUri}?code=wrong&state=wrong`);
      expect(invalid.status).toBe(400);
      response.resolve(fetch(`${redirectUri}?code=accepted&state=expected-state`));
      return true;
    },
  });
  expect(result).toBe("accepted");
  const browser = await response.promise;
  expect(browser.status).toBe(200);
  expect(await browser.text()).toContain("Return to T3 Code");
});

it("releases the callback port on cancellation so sign-in can be retried", async () => {
  const redirectUri = await callbackUri();
  const controller = new AbortController();
  await expect(
    receiveLinearCallback({
      redirectUri,
      state: "state",
      authorizationUrl: "https://linear.app/oauth/authorize",
      signal: controller.signal,
      openExternal: async () => {
        controller.abort();
        return true;
      },
    }),
  ).rejects.toThrow(/canceled/);
  const response = Promise.withResolvers<Response>();
  await expect(
    receiveLinearCallback({
      redirectUri,
      state: "retry",
      authorizationUrl: "https://linear.app/oauth/authorize",
      signal: new AbortController().signal,
      openExternal: async () => {
        response.resolve(fetch(`${redirectUri}?code=second&state=retry`));
        return true;
      },
    }),
  ).resolves.toBe("second");
  expect((await response.promise).status).toBe(200);
});
