import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, readBody, requireUser } from "@/lib/api";
import { draftFollowUp, FOLLOW_UP_VARIANTS, type FollowUpVariant } from "@/lib/followup";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  variant: z.enum(FOLLOW_UP_VARIANTS).optional(),
});

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    const app = db.getApplication(userId, id);
    if (!app) throw new ApiError(404, "Application not found");
    const body = await readBody(req, bodySchema);
    const draft = await draftFollowUp(db, userId, app, body.variant as FollowUpVariant | undefined);
    return NextResponse.json(draft);
  });
}
