import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  applyStageSideEffects,
  handle,
  readBody,
  requireUser,
  serializeApplication,
} from "@/lib/api";
import { parseForUser } from "@/lib/parse-service";
import { syncApplicationReminders } from "@/lib/reminders";
import { emailInputSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    if (!db.getApplication(userId, id)) throw new ApiError(404, "Application not found");
    return NextResponse.json({ emails: db.listEmails(userId, id) });
  });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    const current = db.getApplication(userId, id);
    if (!current) throw new ApiError(404, "Application not found");
    const body = await readBody(req, emailInputSchema);
    if (!body.raw_text.trim()) throw new ApiError(400, "Paste the email text first");

    const draft = await parseForUser(db, userId, body);
    draft.company ||= current.company;
    draft.role ||= current.role;

    const email = db.addEmail(userId, id, {
      subject: draft.subject,
      from_email: draft.from_email,
      received_at: draft.received_at,
      raw_text: body.raw_text,
      parsed: draft,
      confidence: draft.confidence,
      parser_version: draft.parser_version,
    });
    db.addEvent(userId, id, "email", { email_id: email.id, stage: draft.stage });

    if (body.apply) {
      const fields: Record<string, unknown> = {
        company: draft.company,
        role: draft.role,
        location: draft.location || current.location,
        stage: draft.stage,
        action_state: draft.action_state,
        next_action: draft.next_action,
        check_back_at: draft.check_back_at,
        check_back_source: draft.check_back_source,
        next_action_at: draft.next_action_at,
        last_contact_at: draft.received_at,
      };
      applyStageSideEffects(fields, current);
      const updated = db.updateApplication(userId, id, fields)!;
      syncApplicationReminders(db, userId, updated);
      return NextResponse.json({
        email,
        draft,
        application: serializeApplication(updated),
      });
    }

    return NextResponse.json({
      email,
      draft,
      application: serializeApplication(current),
    });
  });
}
