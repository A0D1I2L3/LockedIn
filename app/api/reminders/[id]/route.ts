import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, readBody, requireUser } from "@/lib/api";
import { reminderUpdateSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    if (!db.getReminder(userId, id)) throw new ApiError(404, "Reminder not found");
    const body = await readBody(req, reminderUpdateSchema);
    if (body.channel) {
      db.setReminderChannel(userId, id, body.channel);
      if (!req.nextUrl.searchParams.has("action")) {
        return NextResponse.json({ ok: true, id, channel: body.channel });
      }
    }
    const action = req.nextUrl.searchParams.get("action") || "done";
    const status = action === "dismiss" ? "dismissed" : "done";
    db.completeReminder(userId, id, status);
    return NextResponse.json({ ok: true, id, status });
  });
}
