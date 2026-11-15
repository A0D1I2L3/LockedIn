import fs from "node:fs";
import path from "node:path";

export const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export function getConfig() {
  const root = process.cwd();
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
  const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return {
    root,
    dataDir,
    dbPath: path.resolve(process.env.DB_PATH || path.join(dataDir, "lockedin.db")),
    secretStorePath: path.resolve(
      process.env.SECRET_STORE_FILE || path.join(dataDir, "secrets.json"),
    ),
    secretKeyPath: path.resolve(
      process.env.SECRET_KEY_FILE || path.join(dataDir, ".secret_key"),
    ),
    baseUrl,
    redirectUri: `${baseUrl}/oauth/callback`,
    googleClientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
    googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    secretKey: (process.env.SECRET_KEY || "").trim(),
    defaultFollowUpDays: intEnv("DEFAULT_FOLLOW_UP_DAYS", 7),
    appTimezone: process.env.APP_TIMEZONE || "UTC",
    llmProvider: (process.env.LLM_PROVIDER || "openai").trim().toLowerCase(),
    llmBaseUrl: (process.env.LLM_BASE_URL || "").trim(),
    llmModel: (process.env.LLM_MODEL || "").trim(),
    llmApiKey: (process.env.LLM_API_KEY || "").trim(),
    llmTimeoutSeconds: Number(process.env.LLM_TIMEOUT_SECONDS || 20) || 20,
  };
}

export function ensureDataDir() {
  const { dataDir } = getConfig();
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function intEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
