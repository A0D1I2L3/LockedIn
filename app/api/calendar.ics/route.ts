import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { ApiError, handle, requireUser } from "@/lib/api";
import { userCalendar } from "@/lib/calendar";
import { getDb } from "@/lib/db";
import { appBaseUrl } from "@/lib/parse-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(() => {
    const token = req.nextUrl.searchParams.get("token");
    let db;
    let userId: number;
    if (token) {
      db = getDb();
      const tokenUserId = db.userForCalendarToken(
        crypto.createHash("sha256").update(token).digest("hex"),
      );
      if (tokenUserId === null) throw new ApiError(401, "Invalid calendar token");
      userId = tokenUserId;
    } else {
      const session = requireUser(req);
      db = session.db;
      userId = session.userId;
    }
    return new Response(userCalendar(db, userId, appBaseUrl()), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="internships.ics"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
