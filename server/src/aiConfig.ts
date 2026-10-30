export type AiEnvironment = Record<string, string | undefined>;

export type AiConfig = {
  configured: boolean;
  apiKey?: string;
  baseURL?: string;
  model: string;
  maxTokens: number;
};

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_TOKENS = 4_000;

function value(env: AiEnvironment, name: string): string | undefined {
  const result = env[name]?.trim();
  return result || undefined;
}

function maxTokens(env: AiEnvironment): number {
  const parsed = Number(value(env, "ANTHROPIC_MAX_TOKENS"));
  if (!Number.isInteger(parsed)) return DEFAULT_MAX_TOKENS;
  return Math.min(16_000, Math.max(256, parsed));
}

export function resolveAiConfig(env: AiEnvironment = process.env): AiConfig {
  // ANTHROPIC_APIKEY is kept as a compatibility alias for the existing .env.
  // ANTHROPIC_URL is deliberately not treated as a base URL: it is commonly
  // the Console/settings page. Gateways must use the SDK-standard variable.
  const apiKey = value(env, "ANTHROPIC_API_KEY") ?? value(env, "ANTHROPIC_APIKEY");
  const baseURL = value(env, "ANTHROPIC_BASE_URL");

  return {
    configured: Boolean(apiKey),
    apiKey,
    baseURL,
    model: value(env, "ANTHROPIC_MODEL") ?? DEFAULT_MODEL,
    maxTokens: maxTokens(env),
  };
}

export function normalizeAiEnvironment(env: AiEnvironment = process.env): void {
  if (!value(env, "ANTHROPIC_API_KEY")) {
    const legacyKey = value(env, "ANTHROPIC_APIKEY");
    if (legacyKey) env.ANTHROPIC_API_KEY = legacyKey;
  }
}
