import { NextRequest } from "next/server";
import { ApiError, handle, requireUser } from "@/lib/api";
import { applicationCalendar } from "@/lib/calendar";
import { appBaseUrl } from "@/lib/parse-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    const app = db.getApplication(userId, id);
    if (!app) throw new ApiError(404, "Application not found");
    return new Response(applicationCalendar(app, appBaseUrl()), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="application-${id}.ics"`,
      },
    });
  });
}
