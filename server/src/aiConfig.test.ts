import { describe, expect, it } from "vitest";
import { normalizeAiEnvironment, resolveAiConfig } from "./aiConfig.js";

describe("AI configuration", () => {
  it("accepts the existing ANTHROPIC_APIKEY alias", () => {
    const config = resolveAiConfig({ ANTHROPIC_APIKEY: " legacy-key " });
    expect(config.configured).toBe(true);
    expect(config.apiKey).toBe("legacy-key");
  });

  it("prefers the SDK-standard key and ignores a Console settings URL", () => {
    const config = resolveAiConfig({
      ANTHROPIC_API_KEY: "standard-key",
      ANTHROPIC_APIKEY: "legacy-key",
      ANTHROPIC_URL: "https://platform.claude.com/settings/keys",
    });
    expect(config.apiKey).toBe("standard-key");
    expect(config.baseURL).toBeUndefined();
  });

  it("uses an explicit compatible base URL and clamps the token budget", () => {
    const config = resolveAiConfig({
      ANTHROPIC_API_KEY: "key",
      ANTHROPIC_BASE_URL: "https://gateway.example/v1",
      ANTHROPIC_MODEL: "custom-model",
      ANTHROPIC_MAX_TOKENS: "99999",
    });
    expect(config.baseURL).toBe("https://gateway.example/v1");
    expect(config.model).toBe("custom-model");
    expect(config.maxTokens).toBe(16_000);
  });

  it("normalizes the alias for SDK-compatible consumers", () => {
    const env: Record<string, string | undefined> = { ANTHROPIC_APIKEY: "key" };
    normalizeAiEnvironment(env);
    expect(env.ANTHROPIC_API_KEY).toBe("key");
  });
});
