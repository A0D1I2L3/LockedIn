import * as webpush from "web-push";
import { getConfig } from "@/lib/config";
import type { Database } from "@/lib/db";
import { secretStore } from "@/lib/secrets";

let configuredFor: string | null = null;

export function vapidPublicKey(): string {
  const config = getConfig();
  if (config.vapidPublicKey) return config.vapidPublicKey;
  const existing = secretStore.get("vapid_public");
  if (existing) return existing;
  const generated = webpush.generateVAPIDKeys();
  secretStore.set("vapid_private", generated.privateKey);
  secretStore.set("vapid_public", generated.publicKey);
  return generated.publicKey;
}

function vapidCredentials() {
  const config = getConfig();
  const publicKey = vapidPublicKey();
  const privateKey =
    config.vapidPrivateKey || secretStore.get("vapid_private") || "";
  return { publicKey, privateKey, subject: config.vapidSubject };
}

function configure() {
  const { publicKey, privateKey, subject } = vapidCredentials();
  if (!publicKey || !privateKey) return false;
  if (configuredFor !== publicKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configuredFor = publicKey;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function sendPushToUser(
  db: Database,
  userId: number,
  payload: PushPayload,
): Promise<number> {
  if (!configure()) return 0;
  const subscriptions = db.listPushSubscriptions(userId);
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        db.deletePushSubscription(userId, subscription.endpoint);
      }
    }
  }
  return sent;
}
