import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/api";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

function hash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function GET(req: NextRequest) {
  return handle(() => {
    const { db, userId } = requireUser(req);
    return NextResponse.json({ tokens: db.listCalendarTokens(userId) });
  });
}

export function POST(req: NextRequest) {
  return handle(() => {
    const { db, userId } = requireUser(req);
    const token = crypto.randomBytes(32).toString("base64url");
    const record = db.createCalendarToken(userId, hash(token));
    const base = getConfig().baseUrl;
    return NextResponse.json({
      ok: true,
      id: record?.id,
      token,
      url: `${base}/api/calendar.ics?token=${token}`,
    });
  });
}

export function DELETE(req: NextRequest) {
  return handle(() => {
    const { db, userId } = requireUser(req);
    db.revokeCalendarToken(userId, req.nextUrl.searchParams.get("id") || undefined);
    return NextResponse.json({ ok: true });
  });
}
