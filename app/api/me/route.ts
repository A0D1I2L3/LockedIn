import { NextRequest, NextResponse } from "next/server";
import { optionalUserId } from "@/lib/api";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const userId = optionalUserId(req);
  if (userId === null) return NextResponse.json({ authenticated: false });
  const user = getDb().getUser(userId);
  if (!user) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    id: user.id,
    email: user.email,
    google_user_id: user.google_user_id,
  });
}
