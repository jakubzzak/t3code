import { expect, it } from "vite-plus/test";
import { superhumanOAuthProvider, type SuperhumanCredentials } from "./superhumanOAuth.ts";
it("persists registration, PKCE and refreshed tokens without exposing them in the redirect", async () => {
  let saved: SuperhumanCredentials = {
    redirectUrl: "https://environment.example/oauth/inbox/superhuman/callback",
  };
  let redirect = "";
  const provider = superhumanOAuthProvider({
    credentials: saved,
    state: "opaque-state",
    save: async (next) => {
      saved = next;
    },
    redirect: (url) => {
      redirect = String(url);
    },
  });
  await provider.saveClientInformation?.({ client_id: "registered-client" });
  await provider.saveCodeVerifier("private-verifier");
  await provider.saveTokens({
    access_token: "fixture-access",
    token_type: "Bearer",
    refresh_token: "fixture-refresh",
  });
  expect(await provider.state?.()).toBe("opaque-state");
  expect(await provider.codeVerifier()).toBe("private-verifier");
  expect(await provider.tokens()).toMatchObject({ access_token: "fixture-access" });
  provider.redirectToAuthorization(new URL("https://auth.example/authorize?state=opaque-state"));
  expect(redirect).not.toContain("fixture-access");
  const restored = superhumanOAuthProvider({
    credentials: saved,
    state: "next-state",
    save: async (next) => {
      saved = next;
    },
    redirect: () => {},
  });
  expect(await restored.clientInformation()).toMatchObject({ client_id: "registered-client" });
  await restored.invalidateCredentials?.("tokens");
  expect(await restored.tokens()).toBeUndefined();
  expect(await restored.clientInformation()).toMatchObject({ client_id: "registered-client" });
});
