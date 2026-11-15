import { NextRequest, NextResponse } from "next/server";
import {
  appendNote,
  applyStageSideEffects,
  handle,
  readBody,
  requireUser,
  serializeApplication,
  validateStage,
} from "@/lib/api";
import { syncApplicationReminders } from "@/lib/reminders";
import { outcomeInputSchema } from "@/lib/schemas";
import { MS_PER_DAY, nowMs } from "@/lib/time";
import type { Stage } from "@/lib/types";

export const dynamic = "force-dynamic";

const OUTCOME_STAGE: Record<string, Stage> = {
  rejected: "rejected",
  withdrawn: "withdrawn",
  offer: "offer",
  assessment: "assessment",
  interview: "interview",
};

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    const current = db.getApplication(userId, id);
    if (!current) {
      return NextResponse.json({ detail: "Application not found" }, { status: 404 });
    }
    const body = await readBody(req, outcomeInputSchema);
    const outcome = body.outcome;
    const fields: Record<string, unknown> = {};
    const stage = OUTCOME_STAGE[outcome] || validateStage(body.stage);
    if (stage) fields.stage = stage;

    if (outcome === "follow_up") {
      fields.follow_up_count = Number(current.follow_up_count || 0) + 1;
      fields.action_state = "follow_up_due";
      fields.next_action = "Follow up with the company";
      fields.check_back_at = nowMs() + 3 * MS_PER_DAY;
      fields.check_back_source = "outcome";
      fields.next_action_at = nowMs() + 3 * MS_PER_DAY;
    } else if (outcome === "no_response") {
      fields.action_state = "waiting";
      fields.next_action = "Wait or close as no response";
      fields.check_back_at = nowMs() + 7 * MS_PER_DAY;
      fields.check_back_source = "outcome";
      fields.next_action_at = nowMs() + 7 * MS_PER_DAY;
    } else if (outcome === "other") {
      fields.action_state = "action_required";
    } else if (outcome === "assessment" || outcome === "interview") {
      fields.action_state = "action_required";
    } else if (outcome === "offer") {
      fields.action_state = "action_required";
      fields.next_action = "Review the offer";
      fields.check_back_at = null;
      fields.check_back_source = "none";
      fields.next_action_at = current.next_action_at || nowMs() + 3 * MS_PER_DAY;
    }
    if (body.note) fields.notes = appendNote(current.notes, body.note);
    if (stage) applyStageSideEffects(fields, current);

    const updated = db.updateApplication(userId, id, fields);
    db.addEvent(userId, id, "outcome", {
      outcome,
      stage: fields.stage || current.stage,
      note: body.note,
    });
    if (updated) syncApplicationReminders(db, userId, updated);
    return NextResponse.json(serializeApplication(updated || current));
  });
}
