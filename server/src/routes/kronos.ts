import { Router } from "express";
import { z } from "zod";
import * as kronos from "../providers/kronos.js";

export const kronosRouter = Router();

const candleSchema = z.object({
  time: z.number().int().positive(),
  open: z.number().positive().finite(),
  high: z.number().positive().finite(),
  low: z.number().positive().finite(),
  close: z.number().positive().finite(),
  volume: z.number().nonnegative().finite(),
}).strict();

const requestSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.^=-]{1,24}$/),
  timeframe: z.enum(["5m", "15m", "30m", "1H", "3H", "4H"]),
  model: z.enum(["mini", "small", "base"]),
  lookback: z.number().int().min(32).max(2048),
  predictionLength: z.number().int().min(1).max(120),
  temperature: z.number().min(0.1).max(2),
  topK: z.number().int().min(0).max(512),
  topP: z.number().min(0.1).max(1),
  sampleCount: z.number().int().min(1).max(5),
  candles: z.array(candleSchema).min(32).max(2048),
}).strict().superRefine((value, ctx) => {
  const maxContext = value.model === "mini" ? 2048 : 512;
  if (value.lookback > maxContext) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lookback"],
      message: `${value.model} accepts at most ${maxContext} context candles`,
    });
  }
  if (value.candles.length < Math.min(value.lookback, 32)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["candles"], message: "not enough candle history" });
  }
});

kronosRouter.post("/predict", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid Kronos request" });
  }
  try {
    res.json(await kronos.predict(parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kronos inference unavailable";
    res.status(503).json({ error: message });
  }
});

