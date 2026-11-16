import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, readBody, requireUser } from "@/lib/api";
import { contactPatchSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; contactId: string }> };

export async function PATCH(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id, contactId } = await context.params;
    if (!db.getContact(userId, id, contactId)) throw new ApiError(404, "Contact not found");
    const body = await readBody(req, contactPatchSchema);
    const fields: Record<string, unknown> = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    );
    return NextResponse.json(db.updateContact(userId, id, contactId, fields));
  });
}

export async function DELETE(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id, contactId } = await context.params;
    if (!db.getContact(userId, id, contactId)) throw new ApiError(404, "Contact not found");
    db.deleteContact(userId, id, contactId);
    return NextResponse.json({ ok: true });
  });
}
