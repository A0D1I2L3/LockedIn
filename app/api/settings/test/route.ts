import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle, isProvider, llmConfigFor, readBody, requireUser } from "@/lib/api";
import { validateLlmBaseUrl } from "@/lib/network";
import { makeLLMConfig, testLLMConnection } from "@/lib/parser/llm";
import { llmTestInputSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

function sameEndpoint(a: string, b: string) {
  return a.trim().replace(/\/+$/, "").toLowerCase() === b.trim().replace(/\/+$/, "").toLowerCase();
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { db, userId } = requireUser(req);
    const body = await readBody(req, llmTestInputSchema);
    const saved = llmConfigFor(db, userId);

    const provider = (body.provider || saved.provider).trim().toLowerCase();
    if (!isProvider(provider)) throw new ApiError(400, "Unknown LLM provider.");
    const model = (body.model || saved.model).trim();
    if (!model) throw new ApiError(400, "Add a model name first.");

    let baseUrl: string;
    try {
      baseUrl = await validateLlmBaseUrl(body.base_url || saved.baseUrl);
    } catch (urlError) {
      throw new ApiError(400, urlError instanceof Error ? urlError.message : "Invalid base URL.");
    }

    const endpointChanged =
      provider !== saved.provider || !sameEndpoint(baseUrl, saved.baseUrl);
    const enteredKey = (body.api_key || "").trim();
    if (!enteredKey && endpointChanged) {
      throw new ApiError(400, "Enter the API key for this endpoint before testing.");
    }

    const config = makeLLMConfig({
      provider,
      baseUrl,
      model,
      apiKey: enteredKey || saved.apiKey,
      timeoutMs: 15_000,
    });

    try {
      const message = await testLLMConnection(config);
      return NextResponse.json({ ok: true, message });
    } catch (testError) {
      throw new ApiError(
        502,
        testError instanceof Error ? testError.message : "Could not reach the provider.",
      );
    }
  });
}
