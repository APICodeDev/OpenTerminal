import type { CryptoRow } from "./coingecko.js";
import type { Quote, Candle } from "./yahoo.js";
import { CRYPTO_ASSETS, CRYPTO_SYMBOLS, cryptoAsset } from "./cryptoSymbols.js";

export { CRYPTO_SYMBOLS };

const NAMES = new Map(CRYPTO_ASSETS.map((asset) => [asset.base + "USDT", asset.name]));

/** Fallback crypto board built from Binance public 24hr tickers (no key required). */
export async function markets(): Promise<CryptoRow[]> {
  const symbols = CRYPTO_ASSETS.map((asset) => asset.base + "USDT");
  const url =
    "https://api.binance.com/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(symbols));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const rows: any[] = await res.json();
  return rows
    .map((r) => ({
      id: r.symbol,
      symbol: r.symbol.replace("USDT", "USD"),
      name: NAMES.get(r.symbol) ?? r.symbol,
      price: +r.lastPrice,
      changePercent24h: +r.priceChangePercent,
      marketCap: null,
      volume24h: +r.quoteVolume,
      rank: null,
      sparkline: [],
    }))
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
}

export async function orderBook(symbol: string, limit = 20): Promise<{ bids: [string, string][]; asks: [string, string][] }> {
  const base = cryptoAsset(symbol)?.base ?? symbol.toUpperCase().replace(/USD(T)?$/, "");
  const pair = encodeURIComponent(base + "USDT");
  const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${pair}&limit=${limit}`);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const d = await res.json();
  return { bids: d.bids ?? [], asks: d.asks ?? [] };
}

/** Single-symbol quote so crypto tickers can flow through the same /api/quotes path as stocks. */
export async function quote(symbol: string): Promise<Quote> {
  const asset = cryptoAsset(symbol);
  const base = asset?.base ?? symbol.toUpperCase().replace(/USD(T)?$/, "");
  const pair = base + "USDT";
  const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`);
  if (!res.ok) throw new Error(`binance ticker ${res.status}`);
  const d = await res.json();
  return {
    symbol: asset?.symbol ?? symbol.toUpperCase(),
    name: NAMES.get(pair) ?? symbol.toUpperCase(),
    price: +d.lastPrice,
    change: +d.priceChange,
    changePercent: +d.priceChangePercent,
    open: +d.openPrice,
    high: +d.highPrice,
    low: +d.lowPrice,
    previousClose: +d.prevClosePrice,
    bid: +d.bidPrice || null,
    ask: +d.askPrice || null,
    volume: +d.volume,
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
    exchange: "Binance",
    marketState: "Open",
    time: null,
    source: "binance",
  };
}

const RANGE_TO_KLINE: Record<string, { interval: string; limit: number }> = {
  "1D": { interval: "5m", limit: 288 },
  "5D": { interval: "15m", limit: 480 },
  "1M": { interval: "1h", limit: 720 },
  "6M": { interval: "4h", limit: 1080 },
  YTD: { interval: "1d", limit: 400 },
  "1Y": { interval: "1d", limit: 365 },
  "5Y": { interval: "1w", limit: 260 },
  MAX: { interval: "1M", limit: 200 },
};

const RANGE_SECONDS: Record<string, number> = {
  "1D": 24 * 60 * 60,
  "5D": 5 * 24 * 60 * 60,
  "1M": 30 * 24 * 60 * 60,
  "6M": 180 * 24 * 60 * 60,
  YTD: 366 * 24 * 60 * 60,
  "1Y": 365 * 24 * 60 * 60,
  "5Y": 5 * 365 * 24 * 60 * 60,
  MAX: 10 * 365 * 24 * 60 * 60,
};

const FUTURES_INTERVALS: Record<string, { apiInterval: string; seconds: number; targetSeconds?: number }> = {
  "1m": { apiInterval: "1m", seconds: 60 },
  "5m": { apiInterval: "5m", seconds: 5 * 60 },
  "15m": { apiInterval: "15m", seconds: 15 * 60 },
  "30m": { apiInterval: "30m", seconds: 30 * 60 },
  "1H": { apiInterval: "1h", seconds: 60 * 60 },
  "3H": { apiInterval: "1h", seconds: 60 * 60, targetSeconds: 3 * 60 * 60 },
  "4H": { apiInterval: "4h", seconds: 4 * 60 * 60 },
};

/** Candles from the same USD-M futures venue used by the order-flow capture. */
export async function futuresHistory(symbol: string, rangeKey: string, interval: string): Promise<Candle[]> {
  const base = cryptoAsset(symbol)?.base ?? symbol.toUpperCase().replace(/USD(T)?$/, "");
  const pair = base + "USDT";
  const explicit = FUTURES_INTERVALS[interval];
  const automatic = RANGE_TO_KLINE[rangeKey] ?? RANGE_TO_KLINE["6M"];
  const apiInterval = explicit?.apiInterval ?? automatic.interval;
  const seconds = explicit?.seconds ?? {
    "5m": 5 * 60, "15m": 15 * 60, "1h": 60 * 60, "4h": 4 * 60 * 60,
    "1d": 24 * 60 * 60, "1w": 7 * 24 * 60 * 60, "1M": 30 * 24 * 60 * 60,
  }[apiInterval] ?? 60;
  const limit = Math.min(1500, Math.max(1, Math.ceil((RANGE_SECONDS[rangeKey] ?? RANGE_SECONDS["6M"]) / seconds)));
  const res = await fetch(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(apiInterval)}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`binance futures klines ${res.status}`);
  const rows: any[] = await res.json();
  const candles = rows.map((r) => ({
    time: Math.round(r[0] / 1000),
    open: +r[1],
    high: +r[2],
    low: +r[3],
    close: +r[4],
    volume: +r[5],
  }));
  if (!explicit?.targetSeconds) return candles;
  const grouped = new Map<number, Candle>();
  for (const candle of candles) {
    const time = Math.floor(candle.time / explicit.targetSeconds) * explicit.targetSeconds;
    const current = grouped.get(time);
    if (!current) grouped.set(time, { ...candle, time });
    else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += candle.volume;
    }
  }
  return [...grouped.values()];
}

export async function history(symbol: string, rangeKey: string): Promise<Candle[]> {
  const { interval, limit } = RANGE_TO_KLINE[rangeKey] ?? RANGE_TO_KLINE["6M"];
  const base = cryptoAsset(symbol)?.base ?? symbol.toUpperCase().replace(/USD(T)?$/, "");
  const pair = base + "USDT";
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`binance klines ${res.status}`);
  const rows: any[] = await res.json();
  return rows.map((r) => ({
    time: Math.round(r[0] / 1000),
    open: +r[1],
    high: +r[2],
    low: +r[3],
    close: +r[4],
    volume: +r[5],
  }));
}
