import { describe, expect, test } from "vitest";

import { AnthropicClaudeProvider } from "../src/agent/AnthropicClaudeProvider.js";
import { AzureOpenAIProvider } from "../src/agent/AzureOpenAIProvider.js";
import { GoogleGeminiProvider } from "../src/agent/GoogleGeminiProvider.js";
import { OpenAICompatibleProvider } from "../src/agent/OpenAICompatibleProvider.js";
import { OpenRouterProvider } from "../src/agent/OpenRouterProvider.js";
import { createRuntime } from "../src/container.js";

describe("provider factory", () => {
  test("runtime resolves anthropic provider", async () => {
    const runtime = createRuntime({
      service: {
        provider: "anthropic-claude",
        anthropicApiKey: "test-key"
      }
    });
    try {
      const provider = runtime.container.resolve("provider");
      expect(provider).toBeInstanceOf(AnthropicClaudeProvider);
    } finally {
      await runtime.close();
    }
  });

  test("runtime resolves gemini provider", async () => {
    const runtime = createRuntime({
      service: {
        provider: "google-gemini",
        geminiApiKey: "test-key"
      }
    });
    try {
      const provider = runtime.container.resolve("provider");
      expect(provider).toBeInstanceOf(GoogleGeminiProvider);
    } finally {
      await runtime.close();
    }
  });

  test("runtime resolves openrouter provider", async () => {
    const runtime = createRuntime({
      service: {
        provider: "openrouter",
        openrouterApiKey: "test-key"
      }
    });
    try {
      const provider = runtime.container.resolve("provider");
      expect(provider).toBeInstanceOf(OpenRouterProvider);
    } finally {
      await runtime.close();
    }
  });

  test("runtime resolves azure openai provider", async () => {
    const runtime = createRuntime({
      service: {
        provider: "azure-openai",
        azureOpenaiApiKey: "test-key",
        azureOpenaiEndpoint: "https://example.openai.azure.com",
        azureOpenaiDeployment: "gpt4o"
      }
    });
    try {
      const provider = runtime.container.resolve("provider");
      expect(provider).toBeInstanceOf(AzureOpenAIProvider);
    } finally {
      await runtime.close();
    }
  });

  test("runtime resolves openai-compatible provider", async () => {
    const runtime = createRuntime({
      service: {
        provider: "openai-compatible",
        openaiCompatibleApiKey: "test-key",
        openaiCompatibleBaseUrl: "https://example.com/v1"
      }
    });
    try {
      const provider = runtime.container.resolve("provider");
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    } finally {
      await runtime.close();
    }
  });

  test("azure-openai requires endpoint", () => {
    expect(() =>
      createRuntime({
        service: {
          provider: "azure-openai",
          azureOpenaiApiKey: "test-key",
          azureOpenaiDeployment: "gpt4o",
          azureOpenaiEndpoint: undefined
        }
      })
    ).toThrow(/AZURE_OPENAI_ENDPOINT/);
  });

  test("openai-compatible requires base url", () => {
    expect(() =>
      createRuntime({
        service: {
          provider: "openai-compatible",
          openaiCompatibleApiKey: "test-key",
          openaiCompatibleBaseUrl: undefined
        }
      })
    ).toThrow(/OPENAI_COMPATIBLE_BASE_URL/);
  });
});
