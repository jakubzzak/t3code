import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
export interface SuperhumanCredentials {
  redirectUrl: string;
  client?: unknown;
  tokens?: unknown;
  verifier?: string;
}
/** SDK handles discovery, registration, PKCE and token refresh; storage stays environment-owned. */
export function superhumanOAuthProvider(input: {
  credentials: SuperhumanCredentials;
  state: string;
  save: (value: SuperhumanCredentials) => Promise<void>;
  redirect: (url: URL) => void;
}): OAuthClientProvider {
  let current = input.credentials;
  async function update(next: SuperhumanCredentials) {
    await input.save(next);
    current = next;
  }
  return {
    redirectUrl: current.redirectUrl,
    clientMetadata: {
      client_name: "Blackbird Inbox",
      redirect_uris: [current.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    state: () => input.state,
    clientInformation: () =>
      current.client === undefined ? undefined : OAuthClientInformationSchema.parse(current.client),
    saveClientInformation: (client) => update({ ...current, client }),
    tokens: () =>
      current.tokens === undefined ? undefined : OAuthTokensSchema.parse(current.tokens),
    saveTokens: (tokens) => update({ ...current, tokens }),
    redirectToAuthorization: input.redirect,
    saveCodeVerifier: (verifier) => update({ ...current, verifier }),
    codeVerifier: () => {
      if (!current.verifier) throw new Error("This authorization attempt expired. Connect again.");
      return current.verifier;
    },
    invalidateCredentials: (scope) => {
      const next = { ...current };
      if (scope === "all" || scope === "client") delete next.client;
      if (scope === "all" || scope === "tokens") delete next.tokens;
      if (scope === "all" || scope === "verifier") delete next.verifier;
      return update(next);
    },
  };
}
