import { NextRequest, NextResponse } from "next/server";
import {
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
import { applicationInputSchema } from "@/lib/schemas";
import { nowMs } from "@/lib/time";
import { TERMINAL_STAGES } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(() => {
    const { db, userId } = requireUser(req);
    const params = req.nextUrl.searchParams;
    const rows = db.listApplications(userId, {
      stage: params.get("stage") || "all",
      status: params.get("status") || "all",
      q: params.get("q") || "",
      limit: Math.min(Number(params.get("limit") || 500), 1000),
      offset: Math.max(Number(params.get("offset") || 0), 0),
    });
    return NextResponse.json({
      applications: rows.map(serializeApplication),
      count: rows.length,
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const body = await readBody(req, applicationInputSchema);
    const prefs = userSettings(db, userId);
    const timezone = prefs.timezone || "UTC";
    const stage = validateStage(body.stage) || "applied";
    const checkBackAt = parseWhenFor(body.check_back_at, timezone);

    const data: Record<string, unknown> = {
      company: body.company,
      role: body.role,
      location: body.location,
      job_url: body.job_url,
      source: body.source,
      stage,
      status: "active",
      next_action: body.next_action,
      notes: body.notes,
      applied_at: parseWhenFor(body.applied_at, timezone) || nowMs(),
      check_back_at:
        checkBackAt ||
        defaultCheckBackFor(Number(prefs.default_follow_up_days || 7), timezone),
      check_back_source: body.check_back_source || (checkBackAt ? "manual" : "default"),
      next_action_at: parseWhenFor(body.next_action_at, timezone),
    };
    if (TERMINAL_STAGES.has(stage)) {
      data.status = "closed";
      data.closed_at = nowMs();
      data.check_back_at = null;
    }
    if (!data.next_action) {
      data.next_action = stage === "applied" ? "Wait for a response" : "";
    }

    const created = db.createApplication(userId, data);
    db.addEvent(userId, created.id, "created", { stage });
    syncApplicationReminders(db, userId, created);
    return NextResponse.json(serializeApplication(created));
  });
}
