import { afterEach, describe, expect, it, vi } from "vitest";
import { llmEndpoint, makeLLMConfig, parseWithLLM, PROVIDER_DEFAULTS } from "@/lib/parser/llm";

function mockFetch(data: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => data,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("LLM providers", () => {
  it("uses provider defaults and endpoints", () => {
    const claude = makeLLMConfig({ provider: "claude", apiKey: "key" });
    expect(claude.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(llmEndpoint(claude)).toBe("https://api.anthropic.com/v1/messages");
    expect(claude.model).toBe(PROVIDER_DEFAULTS.claude.model);

    const grok = makeLLMConfig({ provider: "grok", apiKey: "key" });
    expect(llmEndpoint(grok)).toBe("https://api.x.ai/v1/chat/completions");

    const openai = makeLLMConfig({ apiKey: "key" });
    expect(llmEndpoint(openai)).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("sends and parses a Claude request", async () => {
    const fetchMock = mockFetch({
      content: [
        {
          type: "text",
          text: '```json\n{"company": "Acme", "role": "SWE Intern", "stage": "interview", "confidence": 0.8, "evidence": ["interview"]}\n```',
        },
      ],
    });
    const result = await parseWithLLM("We would like to interview you.", {
      subject: "Next steps",
      config: makeLLMConfig({ provider: "claude", apiKey: "sk-ant-test" }),
    });
    expect(result?.company).toBe("Acme");
    expect(result?.stage).toBe("interview");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBeTruthy();
    const payload = JSON.parse(init.body as string);
    expect(payload.system).toBeTruthy();
    expect(payload.messages[0].role).toBe("user");
    expect(payload.response_format).toBeUndefined();
  });

  it("sends an OpenAI-compatible request", async () => {
    const fetchMock = mockFetch({
      choices: [
        {
          message: {
            content: '{"company": "Globex", "stage": "applied", "confidence": 0.7, "evidence": []}',
          },
        },
      ],
    });
    const result = await parseWithLLM("Thanks for applying.", {
      subject: "Application received",
      config: makeLLMConfig({ provider: "grok", apiKey: "xai-test" }),
    });
    expect(result?.company).toBe("Globex");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer xai-test");
    expect(JSON.parse(init.body as string).response_format).toEqual({ type: "json_object" });
  });

  it("skips the request when there is no API key", async () => {
    const fetchMock = mockFetch({});
    expect(
      await parseWithLLM("text", { config: makeLLMConfig({ provider: "openai" }) }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
