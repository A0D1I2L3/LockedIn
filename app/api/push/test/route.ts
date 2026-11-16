import { NextRequest, NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/api";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const sent = await sendPushToUser(db, userId, {
      title: "LockedIn test",
      body: "Push notifications are working on this device.",
      url: "/app",
      tag: "test",
    });
    return NextResponse.json({ ok: sent > 0, sent });
  });
}
