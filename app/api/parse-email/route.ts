import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, readBody, requireUser } from "@/lib/api";
import { parseForUser } from "@/lib/parse-service";
import { emailInputSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const body = await readBody(req, emailInputSchema);
    if (!body.raw_text.trim()) throw new ApiError(400, "Paste the email text first");
    return NextResponse.json(await parseForUser(db, userId, body));
  });
}
