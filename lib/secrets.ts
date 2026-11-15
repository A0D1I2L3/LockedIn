import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";

function readOrCreateKey(): Buffer {
  const config = getConfig();
  if (config.secretKey) {
    return crypto.createHash("sha256").update(config.secretKey).digest();
  }
  if (fs.existsSync(config.secretKeyPath)) {
    const stored = fs.readFileSync(config.secretKeyPath, "utf8").trim();
    if (stored) return Buffer.from(stored, "hex");
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(config.secretKeyPath), { recursive: true });
  fs.writeFileSync(config.secretKeyPath, key.toString("hex") + "\n", { mode: 0o600 });
  return key;
}

let cachedKey: Buffer | null = null;

export function secretKeyBytes(): Buffer {
  if (!cachedKey) cachedKey = readOrCreateKey();
  return cachedKey;
}

export function encryptSecret(value: string): string {
  const key = secretKeyBytes();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(token: string): string | null {
  try {
    const [ivPart, tagPart, dataPart] = token.split(".");
    if (!ivPart || !tagPart || !dataPart) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      secretKeyBytes(),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function readAll(): Record<string, string> {
  const { secretStorePath } = getConfig();
  try {
    if (!fs.existsSync(secretStorePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(secretStorePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(values: Record<string, string>) {
  const { secretStorePath, dataDir } = getConfig();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(secretStorePath, JSON.stringify(values, null, 2), { mode: 0o600 });
}

export const secretStore = {
  get(name: string): string | null {
    const token = readAll()[name];
    return token ? decryptSecret(token) : null;
  },
  set(name: string, value: string) {
    const data = readAll();
    data[name] = encryptSecret(value);
    writeAll(data);
  },
  setMany(values: Record<string, string>) {
    const data = readAll();
    for (const [name, value] of Object.entries(values)) {
      if (value) data[name] = encryptSecret(value);
    }
    writeAll(data);
  },
  clear(name: string) {
    const data = readAll();
    if (name in data) {
      delete data[name];
      writeAll(data);
    }
  },
};
