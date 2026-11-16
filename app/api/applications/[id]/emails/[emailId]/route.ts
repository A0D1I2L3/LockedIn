import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; emailId: string }> };

export async function DELETE(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id, emailId } = await context.params;
    if (!db.getApplication(userId, id)) throw new ApiError(404, "Application not found");
    const trashId = db.trashEmail(userId, id, emailId);
    if (!trashId) throw new ApiError(404, "Email not found");
    return NextResponse.json({ ok: true, id: emailId, trash_id: trashId });
  });
}
