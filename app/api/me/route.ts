import { NextRequest, NextResponse } from "next/server";
import { handle, optionalUserId, requireUser } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { secretStore } from "@/lib/secrets";

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

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    secretStore.clear(`llm_api_key_${userId}`);
    db.deleteUser(userId);
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  });
}
