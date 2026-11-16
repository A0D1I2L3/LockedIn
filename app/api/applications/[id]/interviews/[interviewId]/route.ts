import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, parseWhenFor, readBody, requireUser, userSettings } from "@/lib/api";
import { interviewPatchSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; interviewId: string }> };

export async function PATCH(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id, interviewId } = await context.params;
    if (!db.getInterview(userId, id, interviewId)) throw new ApiError(404, "Interview not found");
    const body = await readBody(req, interviewPatchSchema);
    const timezone = userSettings(db, userId).timezone || "UTC";
    const fields: Record<string, unknown> = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    );
    if ("scheduled_at" in fields) {
      fields.scheduled_at = fields.scheduled_at
        ? parseWhenFor(fields.scheduled_at, timezone)
        : null;
    }
    const updated = db.updateInterview(userId, id, interviewId, fields);
    return NextResponse.json(updated);
  });
}

export async function DELETE(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id, interviewId } = await context.params;
    if (!db.getInterview(userId, id, interviewId)) throw new ApiError(404, "Interview not found");
    db.deleteInterview(userId, id, interviewId);
    return NextResponse.json({ ok: true });
  });
}
