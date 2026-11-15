import { NextRequest, NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/api";
import { dueItems } from "@/lib/reminders";
import { nowMs } from "@/lib/time";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handle(() => {
    const { db, userId } = requireUser(req);
    const now = nowMs();
    const items = dueItems(db, userId, now);
    return NextResponse.json({ items, count: items.length, now });
  });
}
