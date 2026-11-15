import { NextRequest, NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handle(() => {
    const { db, userId } = requireUser(req);
    return NextResponse.json(db.stats(userId));
  });
}
