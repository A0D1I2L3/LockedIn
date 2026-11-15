import { NextRequest, NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/api";
import { notificationFeed } from "@/lib/calendar";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handle(() => {
    const { db, userId } = requireUser(req);
    return NextResponse.json(notificationFeed(db, userId));
  });
}
