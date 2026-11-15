import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    if (!db.getApplication(userId, id)) throw new ApiError(404, "Application not found");
    return NextResponse.json({
      events: db.listEvents(userId, id),
      emails: db.listEmails(userId, id),
    });
  });
}
