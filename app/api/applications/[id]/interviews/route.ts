import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, parseWhenFor, readBody, requireUser, userSettings } from "@/lib/api";
import { interviewInputSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    if (!db.getApplication(userId, id)) throw new ApiError(404, "Application not found");
    return NextResponse.json({ interviews: db.listInterviews(userId, id) });
  });
}

export async function POST(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    if (!db.getApplication(userId, id)) throw new ApiError(404, "Application not found");
    const body = await readBody(req, interviewInputSchema);
    const timezone = userSettings(db, userId).timezone || "UTC";
    const interview = db.addInterview(userId, id, {
      ...body,
      scheduled_at: body.scheduled_at ? parseWhenFor(body.scheduled_at, timezone) : null,
    });
    db.addEvent(userId, id, "interview_added", { interview_id: interview.id, type: interview.type });
    return NextResponse.json(interview);
  });
}
