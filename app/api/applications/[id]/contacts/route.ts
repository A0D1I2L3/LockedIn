import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, readBody, requireUser } from "@/lib/api";
import { contactInputSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    if (!db.getApplication(userId, id)) throw new ApiError(404, "Application not found");
    return NextResponse.json({ contacts: db.listContacts(userId, id) });
  });
}

export async function POST(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    if (!db.getApplication(userId, id)) throw new ApiError(404, "Application not found");
    const body = await readBody(req, contactInputSchema);
    const contact = db.addContact(userId, id, body);
    db.addEvent(userId, id, "contact_added", { contact_id: contact.id, name: contact.name });
    return NextResponse.json(contact);
  });
}
