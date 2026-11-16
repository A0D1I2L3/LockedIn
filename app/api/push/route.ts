import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, readBody, requireUser } from "@/lib/api";
import { vapidPublicKey } from "@/lib/push";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handle(() => {
    const { db, userId } = requireUser(req);
    return NextResponse.json({
      public_key: vapidPublicKey(),
      subscriptions: db.listPushSubscriptions(userId).length,
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const body = await readBody(req, pushSubscriptionSchema);
    if (!body.endpoint.startsWith("https://")) {
      throw new ApiError(400, "Push endpoint must use HTTPS");
    }
    const saved = db.savePushSubscription(userId, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
    return NextResponse.json({ ok: true, subscription: saved });
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const body = await readBody(req, pushUnsubscribeSchema);
    db.deletePushSubscription(userId, body.endpoint);
    return NextResponse.json({ ok: true });
  });
}
