import { NextRequest, NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handle(() => {
    const { db, userId } = requireUser(req);
    const params = req.nextUrl.searchParams;
    const pendingOnly = params.get("pending_only") !== "false";
    const appId = params.get("app_id") || undefined;
    return NextResponse.json({
      reminders: db.listReminders(userId, { pendingOnly, appId }),
    });
  });
}
