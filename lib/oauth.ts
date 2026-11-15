import { SCOPES, getConfig } from "@/lib/config";
import { secretStore } from "@/lib/secrets";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export function oauthCredentials() {
  const config = getConfig();
  return {
    clientId: config.googleClientId || secretStore.get("google_client_id") || "",
    clientSecret: config.googleClientSecret || secretStore.get("google_client_secret") || "",
  };
}

export function isOAuthConfigured(): boolean {
  const { clientId, clientSecret } = oauthCredentials();
  return Boolean(clientId && clientSecret);
}

export function authorizationUrl(state: string): string {
  const { clientId } = oauthCredentials();
  const config = getConfig();
  if (!clientId) throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID.");
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export async function exchangeCode(code: string) {
  const { clientId, clientSecret } = oauthCredentials();
  const config = getConfig();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google token exchange failed (${tokenResponse.status})`);
  }
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("Google did not return an access token.");

  const userResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userResponse.ok) {
    throw new Error(`Google user lookup failed (${userResponse.status})`);
  }
  const info = (await userResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
  };
  return {
    google_user_id: info.sub || "",
    email: info.email || "",
  };
}
