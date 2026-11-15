import { NextRequest, NextResponse } from "next/server";
import { optionalUserId } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { isOAuthConfigured, oauthCredentials } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const config = getConfig();
  const db = getDb();
  const userId = optionalUserId(req);
  const payload = {
    authenticated: userId !== null,
    oauth_configured: isOAuthConfigured(),
    client_id: oauthCredentials().clientId || null,
    redirect_uri: config.redirectUri,
    base_url: config.baseUrl,
    email: null as string | null,
    stats: { by_stage: {}, total: 0, active: 0, due: 0, upcoming: 0 },
  };
  if (userId !== null) {
    const user = db.getUser(userId);
    payload.email = user?.email || null;
    payload.stats = db.stats(userId) as typeof payload.stats;
  }
  return NextResponse.json(payload);
}
