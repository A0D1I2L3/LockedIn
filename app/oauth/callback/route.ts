import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSession,
} from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { exchangeCode } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const config = getConfig();
  const params = req.nextUrl.searchParams;
  const error = params.get("error");
  if (error) {
    return NextResponse.json({ detail: `Authorization failed: ${error}` }, { status: 400 });
  }
  const code = params.get("code");
  if (!code) {
    return NextResponse.json({ detail: "Missing authorization code" }, { status: 400 });
  }
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const state = params.get("state");
  if (!expectedState || !state || expectedState !== state) {
    return NextResponse.json({ detail: "OAuth state check failed. Try signing in again." }, { status: 400 });
  }

  try {
    const result = await exchangeCode(code);
    if (!result.google_user_id) {
      return NextResponse.json(
        { detail: "Could not determine your Google account. Please try again." },
        { status: 400 },
      );
    }
    const userId = getDb().getOrCreateUser(result.google_user_id, result.email);
    const response = NextResponse.redirect(new URL("/app", config.baseUrl));
    response.cookies.set(SESSION_COOKIE, createSession(userId), {
      httpOnly: true,
      sameSite: "lax",
      secure: config.baseUrl.startsWith("https://"),
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (exchangeError) {
    return NextResponse.json(
      {
        detail: `Could not complete sign-in: ${
          exchangeError instanceof Error ? exchangeError.message : "unknown error"
        }`,
      },
      { status: 400 },
    );
  }
}
