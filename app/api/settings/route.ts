import { NextRequest, NextResponse } from "next/server";
import {
  handle,
  isProvider,
  llmConfigFor,
  optionalUserId,
  readBody,
  userSettings,
} from "@/lib/api";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { isOAuthConfigured, oauthCredentials } from "@/lib/oauth";
import { secretStore } from "@/lib/secrets";
import { preferencesInputSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(() => {
    const config = getConfig();
    const db = getDb();
    const userId = optionalUserId(req);
    const credentials = oauthCredentials();
    const payload: Record<string, unknown> = {
      configured: isOAuthConfigured(),
      client_id: credentials.clientId || "",
      client_secret_set: Boolean(credentials.clientSecret),
      base_url: config.baseUrl,
      redirect_uri: config.redirectUri,
      oauth_redirect_uri: config.redirectUri,
    };
    if (userId !== null) {
      const prefs = userSettings(db, userId);
      const llm = llmConfigFor(db, userId);
      payload.preferences = {
        ...prefs,
        llm_provider: llm.provider,
        llm_base_url: llm.baseUrl,
        llm_model: llm.model,
        llm_api_key_set: Boolean(secretStore.get(`llm_api_key_${userId}`) || config.llmApiKey),
      };
    }
    return NextResponse.json(payload);
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const db = getDb();
    const userId = optionalUserId(req);
    const body = await readBody(req, preferencesInputSchema);

    const toStore: Record<string, string> = {};
    if (body.client_id) toStore.google_client_id = body.client_id.trim();
    if (body.client_secret) toStore.google_client_secret = body.client_secret.trim();
    if (Object.keys(toStore).length) secretStore.setMany(toStore);

    if (userId !== null) {
      const values: Record<string, unknown> = {};
      if (body.parser_mode) values.parser_mode = body.parser_mode;
      if (body.default_follow_up_days !== undefined) {
        values.default_follow_up_days = body.default_follow_up_days;
      }
      if (body.timezone) values.timezone = body.timezone;
      if (body.notifications_enabled !== undefined) {
        values.notifications_enabled = body.notifications_enabled;
      }
      const current = db.getUserSettings(userId);
      const provider = (body.llm_provider || "").trim().toLowerCase();
      if (isProvider(provider)) {
        values.llm_provider = provider;
        if (provider !== current.llm_provider) {
          values.llm_base_url ??= "";
          values.llm_model ??= "";
        }
      }
      if (body.llm_base_url !== undefined) values.llm_base_url = body.llm_base_url.trim();
      if (body.llm_model !== undefined) values.llm_model = body.llm_model.trim();
      if (body.llm_api_key) {
        secretStore.set(`llm_api_key_${userId}`, body.llm_api_key.trim());
      }
      if (Object.keys(values).length) db.setUserSettings(userId, values);
    }

    return NextResponse.json({ ok: true, configured: isOAuthConfigured() });
  });
}
