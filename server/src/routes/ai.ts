import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { resolveAiConfig } from "../aiConfig.js";

export const aiRouter = Router();

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const config = resolveAiConfig();
  if (!config.apiKey) throw new Error("AI_NOT_CONFIGURED");
  if (!client) {
    client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
  }
  return client;
}

const SYSTEM = `You are the AI assistant inside OpenTerminal, a Bloomberg-style financial terminal.
You help the user interpret market data, charts, news, options chains and macro indicators.
Answer concisely and professionally, in the language the user writes in.
When market data is provided in the conversation as JSON context, ground your answer in it.
State clearly when the supplied data is missing, stale, or insufficient. Never invent live prices, order-book levels, liquidations, or trades.
You are not a licensed financial advisor: never give personalized investment advice or tell the user what to buy or sell.`;

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(12_000),
  })).min(1).max(40),
  context: z.unknown().optional(),
});

aiRouter.post("/chat", async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid chat request" });

  const { messages, context } = parsed.data;
  try {
    const serializedContext = context === undefined ? "" : JSON.stringify(context);
    if (serializedContext.length > 100_000) {
      return res.status(413).json({ error: "terminal context too large" });
    }
    const contextBlock = serializedContext
      ? [{ role: "user" as const, content: `Current terminal context (JSON):\n${serializedContext}` }]
      : [];
    const config = resolveAiConfig();
    const response = await getClient().messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [...contextBlock, ...messages],
    });
    if (response.stop_reason === "refusal") {
      return res.json({ text: "The assistant declined to answer this request." });
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("");
    res.json({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "AI_NOT_CONFIGURED" || msg.includes("api_key") || msg.includes("authentication")) {
      return res.status(503).json({ error: "AI assistant unavailable: configure ANTHROPIC_API_KEY (or ANTHROPIC_APIKEY) on the server." });
    }
    if (msg.toLowerCase().includes("credit balance is too low")) {
      return res.status(503).json({ error: "AI assistant unavailable: the Anthropic API account has insufficient credits." });
    }
    res.status(502).json({ error: msg });
  }
});
