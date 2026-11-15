import { NextRequest, NextResponse } from "next/server";
import { handle, readBody, requireUser, serializeApplication } from "@/lib/api";
import { snoozeApplication } from "@/lib/reminders";
import { snoozeInputSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    const current = db.getApplication(userId, id);
    if (!current) {
      return NextResponse.json({ detail: "Application not found" }, { status: 404 });
    }
    const body = await readBody(req, snoozeInputSchema);
    return NextResponse.json(serializeApplication(snoozeApplication(db, userId, current, body.days)));
  });
}
