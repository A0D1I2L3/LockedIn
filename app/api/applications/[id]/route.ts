import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  applyStageSideEffects,
  defaultCheckBackFor,
  handle,
  parseWhenFor,
  readBody,
  requireUser,
  serializeApplication,
  userSettings,
  validateStage,
} from "@/lib/api";
import { syncApplicationReminders } from "@/lib/reminders";
import { applicationPatchSchema } from "@/lib/schemas";
import { TERMINAL_STAGES } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    const app = db.getApplication(userId, id);
    if (!app) throw new ApiError(404, "Application not found");
    return NextResponse.json(serializeApplication(app));
  });
}

export async function PATCH(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    const current = db.getApplication(userId, id);
    if (!current) {
      return NextResponse.json({ detail: "Application not found" }, { status: 404 });
    }
    const body = await readBody(req, applicationPatchSchema);
    const prefs = userSettings(db, userId);
    const timezone = prefs.timezone || "UTC";
    const fields: Record<string, unknown> = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    );
    if ("stage" in fields) fields.stage = validateStage(fields.stage as string) || current.stage;
    for (const key of ["applied_at", "check_back_at", "next_action_at"]) {
      if (key in fields) fields[key] = parseWhenFor(fields[key], timezone);
    }
    applyStageSideEffects(fields, current);
    const nextStage = fields.stage as typeof current.stage | undefined;
    if (
      nextStage &&
      !TERMINAL_STAGES.has(nextStage) &&
      current.status === "closed" &&
      !fields.check_back_at
    ) {
      fields.check_back_at = defaultCheckBackFor(
        Number(prefs.default_follow_up_days || 7),
        timezone,
      );
      fields.check_back_source = "default";
    }
    const updated = db.updateApplication(userId, id, fields);
    if (!updated) {
      return NextResponse.json({ detail: "Application not found" }, { status: 404 });
    }
    db.addEvent(userId, id, "updated", { fields: Object.keys(fields) });
    syncApplicationReminders(db, userId, updated);
    return NextResponse.json(serializeApplication(updated));
  });
}

export async function DELETE(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    if (!db.getApplication(userId, id)) {
      return NextResponse.json({ detail: "Application not found" }, { status: 404 });
    }
    db.deleteApplication(userId, id);
    return NextResponse.json({ ok: true, id });
  });
}
