import { afterEach, describe, expect, test, vi } from "vitest";

import { ChatCompletionProvider } from "../src/agent/ChatCompletionProvider.js";
import type { ChatMessage } from "../src/agent/LLMProvider.js";

describe("ChatCompletionProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("retries once when first completion text is empty", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "" } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "final answer" } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ChatCompletionProvider(
      { apiKey: "k", model: "m" },
      { providerName: "Test", defaultBaseUrl: "https://example.com" }
    );

    const text = await provider.generate([{ role: "user", content: "hello" }]);
    expect(text).toBe("final answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("extracts text from array-form message content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: "line one" },
                  { type: "text", text: "line two" }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ChatCompletionProvider(
      { apiKey: "k", model: "m" },
      { providerName: "Test", defaultBaseUrl: "https://example.com" }
    );

    const text = await provider.generate([{ role: "user", content: "hello" }]);
    expect(text).toBe("line one\nline two");
  });

  test("stream falls back to retry when token stream is empty", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(stream, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "stream fallback text" } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ChatCompletionProvider(
      { apiKey: "k", model: "m" },
      { providerName: "Test", defaultBaseUrl: "https://example.com" }
    );

    let collected = "";
    const text = await provider.generateStream(
      [{ role: "user", content: "hello" }],
      (token) => {
        collected += token;
      }
    );

    expect(text).toBe("stream fallback text");
    expect(collected).toBe("stream fallback text");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("uses custom request path, query params, extra headers, and omits model when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ChatCompletionProvider(
      { apiKey: "k", model: "m" },
      {
        providerName: "Test",
        defaultBaseUrl: "https://example.com",
        requestPath: "/openai/deployments/demo/chat/completions",
        extraQueryParams: { "api-version": "2024-06-01" },
        extraHeaders: { "X-Title": "my-app" },
        includeModelInBody: false
      }
    );

    const text = await provider.generate([{ role: "user", content: "hello" }]);
    expect(text).toBe("ok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/openai/deployments/demo/chat/completions?api-version=2024-06-01");

    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer k");
    expect(headers["X-Title"]).toBe("my-app");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBeUndefined();
    expect(body.stream).toBe(false);
  });

  test("reuses assistant reasoning_content on follow-up request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "<tool_call>{\"name\":\"readonly.list\",\"args\":{\"path\":\".\"}}</tool_call>",
                  reasoning_content: "need file list before final answer"
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "final answer" } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ChatCompletionProvider(
      { apiKey: "k", model: "m" },
      { providerName: "Test", defaultBaseUrl: "https://example.com" }
    );

    const first = await provider.generate([{ role: "user", content: "step 1" }]);
    expect(first).toContain("<tool_call>");

    const secondMessages: ChatMessage[] = [
      { role: "user", content: "step 1" },
      { role: "assistant", content: first },
      { role: "user", content: "TOOL_RESULT {...}" }
    ];
    const second = await provider.generate(secondMessages);
    expect(second).toBe("final answer");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(secondCallInit?.body ?? "{}")) as {
      messages?: Array<Record<string, unknown>>;
    };
    const assistantMessage = body.messages?.find((item) => item.role === "assistant");
    expect(assistantMessage?.reasoning_content).toBe("need file list before final answer");
  });
});
