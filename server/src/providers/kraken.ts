import "../env.js";
import { createHash, createHmac } from "node:crypto";
import type { CryptoRow } from "./coingecko.js";
import type { Candle, Quote } from "./yahoo.js";
import { CRYPTO_ASSETS, cryptoAsset, type CryptoAsset } from "./cryptoSymbols.js";

const SPOT_API = "https://api.kraken.com";
function futuresApi(): string {
  return process.env.KRAKEN_FUTURES_API_URL_LIVE?.replace(/\/$/, "") || "https://futures.kraken.com";
}

type KrakenEnvelope<T> = { error?: string[]; result?: T };

function assertAsset(symbol: string): CryptoAsset {
  const asset = cryptoAsset(symbol);
  if (!asset) throw new Error(`unsupported Kraken USD market: ${symbol}`);
  return asset;
}

async function publicGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(path, SPOT_API);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`kraken ${res.status}`);
  const body = (await res.json()) as KrakenEnvelope<T>;
  if (body.error?.length) throw new Error(`kraken: ${body.error.join(", ")}`);
  if (body.result === undefined) throw new Error("kraken: empty response");
  return body.result;
}

function firstValue<T>(record: Record<string, T>): T {
  const value = Object.values(record)[0];
  if (value === undefined) throw new Error("kraken: market missing from response");
  return value;
}

type Ticker = {
  a: string[]; b: string[]; c: string[]; v: string[]; p: string[];
  t: number[]; l: string[]; h: string[]; o: string;
};

function quoteFromTicker(asset: CryptoAsset, ticker: Ticker): Quote {
  const price = Number(ticker.c[0]);
  const open = Number(ticker.o);
  const change = price - open;
  return {
    symbol: asset.symbol,
    name: asset.name,
    price,
    change,
    changePercent: open ? (change / open) * 100 : null,
    open,
    high: Number(ticker.h[1]),
    low: Number(ticker.l[1]),
    previousClose: null,
    bid: Number(ticker.b[0]),
    ask: Number(ticker.a[0]),
    volume: Number(ticker.v[1]),
    avgVolume: null,
    marketCap: null,
    pe: null,
    eps: null,
    dividendYield: null,
    week52High: null,
    week52Low: null,
    beta: null,
    sharesOutstanding: null,
    currency: "USD",
    exchange: "Kraken",
    marketState: "Open",
    time: Math.floor(Date.now() / 1000),
    source: "kraken",
  };
}

export async function quote(symbol: string): Promise<Quote> {
  const asset = assertAsset(symbol);
  const result = await publicGet<Record<string, Ticker>>("/0/public/Ticker", { pair: asset.krakenSpot });
  return quoteFromTicker(asset, firstValue(result));
}

export async function markets(): Promise<CryptoRow[]> {
  const result = await publicGet<Record<string, Ticker>>("/0/public/Ticker", {
    pair: CRYPTO_ASSETS.map((asset) => asset.krakenSpot).join(","),
  });
  const bySymbol = new Map(
    Object.entries(result).map(([key, ticker]) => [
      key
        .replace(/^X(?=[A-Z]+ZUSD$)/, "")
        .replace("XBT", "BTC")
        .replace("ZUSD", "USD")
        .replace(/^X?DGUSD$/, "DOGEUSD"),
      ticker,
    ])
  );
  return CRYPTO_ASSETS.flatMap((asset, index) => {
    const entry = bySymbol.get(asset.symbol);
    if (!entry) return [];
    const q = quoteFromTicker(asset, entry);
    const price = Number(entry.c[0]);
    return [{
      id: asset.symbol,
      symbol: asset.symbol,
      name: asset.name,
      price,
      changePercent24h: q.changePercent,
      marketCap: null,
      volume24h: Number(entry.v[1]) * price,
      rank: index + 1,
      sparkline: [],
    }];
  }).sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
}

export type OrderLevel = { price: number; quantity: number; notional: number; total: number };
export type OrderBook = {
  symbol: string;
  exchange: "Kraken";
  timestamp: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
  spread: number;
  spreadBps: number;
};

function levels(rows: Array<[string, string, number]>): OrderLevel[] {
  let total = 0;
  return rows.map(([p, q]) => {
    const price = Number(p);
    const quantity = Number(q);
    const notional = price * quantity;
    total += notional;
    return { price, quantity, notional, total };
  });
}

export async function orderBook(symbol: string, count = 100): Promise<OrderBook> {
  const asset = assertAsset(symbol);
  const result = await publicGet<Record<string, { bids: Array<[string, string, number]>; asks: Array<[string, string, number]> }>>(
    "/0/public/Depth",
    { pair: asset.krakenSpot, count: Math.max(10, Math.min(500, count)) }
  );
  const raw = firstValue(result);
  const bids = levels(raw.bids ?? []);
  const asks = levels(raw.asks ?? []);
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const mid = (bestAsk + bestBid) / 2;
  return {
    symbol: asset.symbol,
    exchange: "Kraken",
    timestamp: new Date().toISOString(),
    bids,
    asks,
    spread,
    spreadBps: mid ? (spread / mid) * 10_000 : 0,
  };
}

const RANGE_TO_OHLC: Record<string, { interval: number; seconds: number }> = {
  "1D": { interval: 5, seconds: 86_400 },
  "5D": { interval: 15, seconds: 432_000 },
  "1M": { interval: 60, seconds: 2_592_000 },
  "6M": { interval: 240, seconds: 15_552_000 },
  YTD: { interval: 1440, seconds: 31_536_000 },
  "1Y": { interval: 1440, seconds: 31_536_000 },
  "5Y": { interval: 10080, seconds: 157_680_000 },
  MAX: { interval: 21600, seconds: 315_360_000 },
};

export const CRYPTO_INTERVALS = ["AUTO", "4H", "3H", "1H", "30m", "15m", "5m", "1m", "10s", "1s"] as const;
export type CryptoInterval = (typeof CRYPTO_INTERVALS)[number];

const INTERVAL_TO_OHLC: Record<Exclude<CryptoInterval, "AUTO" | "10s" | "1s">, { baseMinutes: number; targetSeconds: number }> = {
  "4H": { baseMinutes: 240, targetSeconds: 14_400 },
  "3H": { baseMinutes: 60, targetSeconds: 10_800 },
  "1H": { baseMinutes: 60, targetSeconds: 3_600 },
  "30m": { baseMinutes: 30, targetSeconds: 1_800 },
  "15m": { baseMinutes: 15, targetSeconds: 900 },
  "5m": { baseMinutes: 5, targetSeconds: 300 },
  "1m": { baseMinutes: 1, targetSeconds: 60 },
};

function aggregateCandles(candles: Candle[], bucketSeconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const candle of [...candles].sort((a, b) => a.time - b.time)) {
    const time = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
    const current = buckets.get(time);
    if (!current) {
      buckets.set(time, { ...candle, time });
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

async function subMinuteHistory(asset: CryptoAsset, bucketSeconds: 1 | 10): Promise<Candle[]> {
  const result = await publicGet<Record<string, unknown>>("/0/public/Trades", {
    pair: asset.krakenSpot,
    count: 1000,
  });
  const rows = Object.entries(result).find(([key]) => key !== "last")?.[1] as unknown[][] | undefined;
  const tradesAsCandles = (rows ?? []).map((row) => {
    const price = Number(row[0]);
    return {
      time: Math.floor(Number(row[2])),
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number(row[1]),
    };
  });
  return aggregateCandles(tradesAsCandles, bucketSeconds);
}

export function isCryptoInterval(value: string): value is CryptoInterval {
  return (CRYPTO_INTERVALS as readonly string[]).includes(value);
}

export async function history(symbol: string, rangeKey: string, interval: CryptoInterval = "AUTO"): Promise<Candle[]> {
  const asset = assertAsset(symbol);
  const range = RANGE_TO_OHLC[rangeKey] ?? RANGE_TO_OHLC["6M"];
  if (interval === "1s" || interval === "10s") {
    return subMinuteHistory(asset, interval === "1s" ? 1 : 10);
  }
  const requested = interval === "AUTO" ? null : INTERVAL_TO_OHLC[interval];
  const result = await publicGet<Record<string, unknown>>("/0/public/OHLC", {
    pair: asset.krakenSpot,
    interval: requested?.baseMinutes ?? range.interval,
    since: Math.floor(Date.now() / 1000) - range.seconds,
  });
  const rows = Object.entries(result).find(([key]) => key !== "last")?.[1] as unknown[][] | undefined;
  if (!rows) return [];
  const candles = rows.map((row) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[6]),
  }));
  return requested ? aggregateCandles(candles, requested.targetSeconds) : candles;
}

export type Trade = {
  id: string;
  timestamp: string;
  price: number;
  quantity: number;
  side: "buy" | "sell";
  notional: number;
};

export async function trades(symbol: string, count = 100): Promise<Trade[]> {
  const asset = assertAsset(symbol);
  const result = await publicGet<Record<string, unknown>>("/0/public/Trades", { pair: asset.krakenSpot, count });
  const rows = Object.entries(result).find(([key]) => key !== "last")?.[1] as unknown[][] | undefined;
  return (rows ?? []).map((row, index) => {
    const price = Number(row[0]);
    const quantity = Number(row[1]);
    return {
      id: `${row[2]}-${index}`,
      timestamp: new Date(Number(row[2]) * 1000).toISOString(),
      price,
      quantity,
      side: (row[3] === "b" ? "buy" : "sell") as "buy" | "sell",
      notional: price * quantity,
    };
  }).reverse();
}

export type Liquidation = Trade & { type: string; source: "Kraken Futures" };
export type LiquidationBucket = { timestamp: number; volume: number };

export async function liquidations(symbol: string): Promise<{ symbol: string; instrument: string | null; events: Liquidation[]; heatmap: LiquidationBucket[] }> {
  const asset = assertAsset(symbol);
  if (!asset.krakenFuture) return { symbol: asset.symbol, instrument: null, events: [], heatmap: [] };
  const instrument = asset.krakenFuture;
  const futures = futuresApi();
  const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const [historyRes, analyticsRes] = await Promise.allSettled([
    fetch(`${futures}/derivatives/api/v3/history?symbol=${encodeURIComponent(instrument)}`),
    fetch(`${futures}/api/charts/v1/analytics/${encodeURIComponent(instrument)}/liquidation-volume?since=${since}&interval=300`),
  ]);

  const events: Liquidation[] = [];
  if (historyRes.status === "fulfilled" && historyRes.value.ok) {
    const body = await historyRes.value.json() as { history?: Array<Record<string, unknown>> };
    for (const [index, item] of (body.history ?? []).entries()) {
      if (item.type !== "liquidation" && item.type !== "termination") continue;
      const price = Number(item.price);
      const quantity = Number(item.size);
      events.push({
        id: String(item.uid ?? item.trade_id ?? index),
        timestamp: String(item.time),
        price,
        quantity,
        side: item.side === "buy" ? "buy" : "sell",
        notional: price * quantity,
        type: String(item.type),
        source: "Kraken Futures",
      });
    }
  }

  const heatmap: LiquidationBucket[] = [];
  if (analyticsRes.status === "fulfilled" && analyticsRes.value.ok) {
    const body = await analyticsRes.value.json() as { result?: { timestamp?: number[]; data?: Array<string | number> } };
    const timestamps = body.result?.timestamp ?? [];
    const data = body.result?.data ?? [];
    for (let i = 0; i < timestamps.length; i++) {
      heatmap.push({ timestamp: Number(timestamps[i]), volume: Number(data[i] ?? 0) });
    }
  }
  return { symbol: asset.symbol, instrument, events, heatmap };
}

function credentials(): { key: string; secret: string } | null {
  const key = process.env.KRAKEN_LIVE_API_KEY || process.env.KRAKEN_KEY_PUBLIC;
  const secret = process.env.KRAKEN_LIVE_API_SECRET || process.env.KRAKEN_KEY_PRIVATE;
  return key && secret ? { key, secret } : null;
}

export function tradingStatus() {
  return {
    exchange: "Kraken",
    configured: Boolean(credentials()),
    liveTradingEnabled: process.env.KRAKEN_LIVE_TRADING_ENABLED === "true",
  };
}

export function buildSignature(path: string, body: URLSearchParams, secret: string): string {
  const nonce = body.get("nonce") ?? "";
  const hash = createHash("sha256").update(nonce + body.toString()).digest();
  return createHmac("sha512", Buffer.from(secret, "base64")).update(Buffer.concat([Buffer.from(path), hash])).digest("base64");
}

let lastNonce = 0;
async function privateRequest<T>(method: string, fields: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const creds = credentials();
  if (!creds) throw new Error("Kraken credentials are not configured");
  const nonce = Math.max(Date.now() * 1000, lastNonce + 1);
  lastNonce = nonce;
  const body = new URLSearchParams({ nonce: String(nonce) });
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) body.set(key, String(value));
  const path = `/0/private/${method}`;
  const res = await fetch(SPOT_API + path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "API-Key": creds.key,
      "API-Sign": buildSignature(path, body, creds.secret),
    },
    body,
  });
  if (!res.ok) throw new Error(`kraken private ${res.status}`);
  const payload = await res.json() as KrakenEnvelope<T>;
  if (payload.error?.length) throw new Error(`kraken: ${payload.error.join(", ")}`);
  if (payload.result === undefined) throw new Error("kraken: empty private response");
  return payload.result;
}

export function balances() {
  return privateRequest<Record<string, string>>("Balance");
}

export function openOrders() {
  return privateRequest<Record<string, unknown>>("OpenOrders");
}

export type AddOrderInput = {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  volume: number;
  price?: number;
  validate?: boolean;
};

export function addOrder(order: AddOrderInput) {
  const asset = assertAsset(order.symbol);
  if (process.env.KRAKEN_LIVE_TRADING_ENABLED !== "true" && !order.validate) {
    throw new Error("Live Kraken trading is disabled. Set KRAKEN_LIVE_TRADING_ENABLED=true to enable it.");
  }
  return privateRequest<Record<string, unknown>>("AddOrder", {
    pair: asset.krakenSpot,
    type: order.side,
    ordertype: order.orderType,
    volume: order.volume,
    price: order.orderType === "limit" ? order.price : undefined,
    validate: order.validate ? "true" : undefined,
  });
}

export function cancelOrder(txid: string) {
  if (process.env.KRAKEN_LIVE_TRADING_ENABLED !== "true") {
    throw new Error("Live Kraken trading is disabled.");
  }
  return privateRequest<Record<string, unknown>>("CancelOrder", { txid });
}
