import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, requireUser, serializeApplication } from "@/lib/api";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const { id } = await context.params;
    let restored: ReturnType<typeof db.restoreTrash>;
    try {
      restored = db.restoreTrash(userId, id);
    } catch (error) {
      throw new ApiError(
        409,
        error instanceof Error ? error.message : "Could not restore this item.",
      );
    }
    if (!restored) throw new ApiError(404, "Nothing to restore");
    if (restored.kind === "application") {
      return NextResponse.json({
        ok: true,
        kind: restored.kind,
        application: serializeApplication(restored.application),
      });
    }
    return NextResponse.json({ ok: true, kind: restored.kind, email: restored.email });
  });
}
