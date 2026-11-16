import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  handle,
  isProvider,
  llmConfigFor,
  optionalUserId,
  readBody,
  userSettings,
} from "@/lib/api";
import { validateLlmBaseUrl } from "@/lib/network";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { isOAuthConfigured } from "@/lib/oauth";
import { secretStore } from "@/lib/secrets";
import { preferencesInputSchema } from "@/lib/schemas";
import { normalizeTimezone } from "@/lib/time";

export const dynamic = "force-dynamic";

function endpointKey(provider: string, baseUrl: string) {
  return `${provider.toLowerCase()}|${baseUrl.trim().replace(/\/+$/, "").toLowerCase()}`;
}

export async function GET(req: NextRequest) {
  return handle(() => {
    const config = getConfig();
    const db = getDb();
    const userId = optionalUserId(req);
    const payload: Record<string, unknown> = {
      configured: isOAuthConfigured(),
      base_url: config.baseUrl,
      redirect_uri: config.redirectUri,
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

    if (userId !== null) {
      const values: Record<string, unknown> = {};
      if (body.parser_mode) values.parser_mode = body.parser_mode;
      if (body.default_follow_up_days !== undefined) {
        values.default_follow_up_days = body.default_follow_up_days;
      }
      if (body.timezone) values.timezone = normalizeTimezone(body.timezone);
      if (body.notifications_enabled !== undefined) {
        values.notifications_enabled = body.notifications_enabled;
      }
      if (body.push_enabled !== undefined) values.push_enabled = body.push_enabled;
      if (body.digest_enabled !== undefined) values.digest_enabled = body.digest_enabled;
      if (body.digest_time !== undefined) values.digest_time = body.digest_time;
      if (body.quiet_hours_start !== undefined) {
        values.quiet_hours_start = body.quiet_hours_start;
      }
      if (body.quiet_hours_end !== undefined) values.quiet_hours_end = body.quiet_hours_end;
      if (body.reminder_channel !== undefined) {
        values.reminder_channel = body.reminder_channel;
      }
      if (body.telegram_chat_id !== undefined) {
        values.telegram_chat_id = body.telegram_chat_id;
      }
      const current = db.getUserSettings(userId);
      const currentLlm = llmConfigFor(db, userId);
      const provider = (body.llm_provider || "").trim().toLowerCase();
      if (isProvider(provider)) {
        values.llm_provider = provider;
        if (provider !== current.llm_provider) {
          values.llm_base_url ??= "";
          values.llm_model ??= "";
        }
      }
      let nextBaseInput = body.llm_base_url;
      if (nextBaseInput !== undefined) {
        try {
          nextBaseInput = await validateLlmBaseUrl(nextBaseInput);
        } catch (urlError) {
          throw new ApiError(
            400,
            urlError instanceof Error ? urlError.message : "Invalid base URL.",
          );
        }
        values.llm_base_url = nextBaseInput;
      }
      if (body.llm_model !== undefined) values.llm_model = body.llm_model.trim();
      const nextProvider = isProvider(provider) ? provider : currentLlm.provider;
      const nextBaseUrl =
        nextBaseInput !== undefined ? nextBaseInput : currentLlm.baseUrl;
      const endpointChanged =
        endpointKey(nextProvider, nextBaseUrl) !== endpointKey(currentLlm.provider, currentLlm.baseUrl);
      let keyCleared = false;
      if (body.llm_api_key_clear) {
        secretStore.clear(`llm_api_key_${userId}`);
        keyCleared = true;
      }
      if (body.llm_api_key) {
        secretStore.set(`llm_api_key_${userId}`, body.llm_api_key.trim());
      } else if (endpointChanged) {
        secretStore.clear(`llm_api_key_${userId}`);
        keyCleared = true;
      }
      if (Object.keys(values).length) db.setUserSettings(userId, values);
      return NextResponse.json({
        ok: true,
        configured: isOAuthConfigured(),
        llm_api_key_cleared: keyCleared,
      });
    }

    return NextResponse.json({ ok: true, configured: isOAuthConfigured() });
  });
}
