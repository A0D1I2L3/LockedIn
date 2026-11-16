import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
]);

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (value.startsWith("::ffff:")) {
    return isPrivateIPv4(value.slice("::ffff:".length));
  }
  return false;
}

function isPrivateAddress(address: string): boolean {
  return net.isIP(address) === 4
    ? isPrivateIPv4(address)
    : net.isIP(address) === 6
      ? isPrivateIPv6(address)
      : false;
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}

export async function validateLlmBaseUrl(value: string): Promise<string> {
  const raw = value.trim();
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Base URL must be a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Base URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Base URL must not contain credentials.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) throw new Error("Base URL must include a hostname.");
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error("This host is not allowed.");
  }

  const loopback = isLoopbackHostname(hostname);
  const allowPrivate =
    process.env.ALLOW_PRIVATE_LLM_BASE_URL === "1" || process.env.NODE_ENV !== "production";
  if (url.protocol === "http:" && !loopback && !allowPrivate) {
    throw new Error("Base URL must use https.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname) && !allowPrivate) {
      throw new Error("Private and link-local addresses are not allowed.");
    }
    return url.toString().replace(/\/+$/, "");
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("Base URL hostname could not be resolved.");
  }
  if (addresses.some((entry) => isPrivateAddress(entry.address)) && !allowPrivate) {
    throw new Error("Base URL resolves to a private or link-local address.");
  }
  return url.toString().replace(/\/+$/, "");
}
