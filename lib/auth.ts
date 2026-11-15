import crypto from "node:crypto";
import { secretKeyBytes } from "@/lib/secrets";

export const SESSION_COOKIE = "lockedin_session";
export const OAUTH_STATE_COOKIE = "lockedin_oauth_state";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function sign(payload: string): string {
  return crypto.createHmac("sha256", secretKeyBytes()).update(payload).digest("hex");
}

export function createSession(userId: number): string {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = `${userId}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

export function validateSession(token: string | undefined | null): number | null {
  if (!token) return null;
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const payload = token.slice(0, lastDot);
  const provided = token.slice(lastDot + 1);
  const expected = sign(payload);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  const userId = Number(payload.split(".", 1)[0]);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

export function createOAuthState(): string {
  return crypto.randomBytes(24).toString("base64url");
}
