import { NextRequest, NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/api";
import { notificationFeed } from "@/lib/calendar";
import { maybeSweep } from "@/lib/notify";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    await maybeSweep(db);
    return NextResponse.json(notificationFeed(db, userId));
  });
}
