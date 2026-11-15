import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { authorizationUrl, isOAuthConfigured } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export function GET() {
  const config = getConfig();
  if (!isOAuthConfigured()) {
    return NextResponse.redirect(new URL("/?settings=1", config.baseUrl));
  }
  const state = crypto.randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authorizationUrl(state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.baseUrl.startsWith("https://"),
    maxAge: 600,
    path: "/",
  });
  return response;
}
