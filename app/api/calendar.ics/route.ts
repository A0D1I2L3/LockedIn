import { NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/api";
import { userCalendar } from "@/lib/calendar";
import { appBaseUrl } from "@/lib/parse-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(() => {
    const { db, userId } = requireUser(req);
    return new Response(userCalendar(db, userId, appBaseUrl()), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="internships.ics"',
      },
    });
  });
}
