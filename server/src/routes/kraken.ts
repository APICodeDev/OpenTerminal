import { Router } from "express";
import { z } from "zod";
import * as kraken from "../providers/kraken.js";
import { canonicalCryptoSymbol } from "../providers/cryptoSymbols.js";

export const krakenRouter = Router();

function sendError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const disabled = message.toLowerCase().includes("disabled");
  res.status(disabled ? 403 : 502).json({ error: message });
}

krakenRouter.get("/status", (_req, res) => res.json(kraken.tradingStatus()));

krakenRouter.get("/balances", async (_req, res) => {
  try {
    res.json(await kraken.balances());
  } catch (error) {
    sendError(res, error);
  }
});

krakenRouter.get("/orders", async (_req, res) => {
  try {
    res.json(await kraken.openOrders());
  } catch (error) {
    sendError(res, error);
  }
});

const orderSchema = z.object({
  symbol: z.string().transform((value, ctx) => {
    const symbol = canonicalCryptoSymbol(value);
    if (!symbol) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unsupported crypto symbol" });
      return z.NEVER;
    }
    return symbol;
  }),
  side: z.enum(["buy", "sell"]),
  orderType: z.enum(["market", "limit"]),
  volume: z.number().positive().finite(),
  price: z.number().positive().finite().optional(),
  validate: z.boolean().optional().default(false),
  confirmation: z.string(),
}).superRefine((order, ctx) => {
  if (order.orderType === "limit" && order.price === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["price"], message: "price is required for limit orders" });
  }
  if (!order.validate && order.confirmation !== "OPERAR EN KRAKEN") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmation"], message: "live order confirmation is required" });
  }
});

krakenRouter.post("/orders", async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
  try {
    const { confirmation: _confirmation, ...order } = parsed.data;
    res.json(await kraken.addOrder(order));
  } catch (error) {
    sendError(res, error);
  }
});

krakenRouter.delete("/orders/:txid", async (req, res) => {
  if (!/^[A-Z0-9-]{8,64}$/i.test(req.params.txid)) return res.status(400).json({ error: "invalid Kraken order id" });
  try {
    res.json(await kraken.cancelOrder(req.params.txid));
  } catch (error) {
    sendError(res, error);
  }
});
