import { CRYPTO_ASSETS } from "./cryptoSymbols.js";

const CRYPTO_BASES = ["BTC", "ETH", "ADA", "AVAX", "FIL", "NEAR", "UNI", "SUI", "XRP", "HBAR", "RENDER", "SOL"];
const LIQUIDATION_RETENTION_MS = 24 * 60 * 60 * 1000;
const LIQUIDATION_BUCKET_MS = 5 * 60 * 1000;
const ORDERFLOW_RETENTION_MS = 30 * 60 * 1000;
const ORDERFLOW_SAMPLE_MS = 1_000;
const ORDERFLOW_MAX_SAMPLES = ORDERFLOW_RETENTION_MS / ORDERFLOW_SAMPLE_MS;
const ORDERFLOW_MAX_EVENTS = 20_000;
const RECONNECT_MAX_MS = 30_000;

type JsonObject = Record<string, unknown>;
type OrderLevel = { price: number; quantity: number; notional: number; total: number };
type DepthSample = {
  timestamp: number;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
};
type OrderflowEvent = {
  id: string;
  timestamp: number;
  price: number;
  quantity: number;
  notional: number;
  side: "buy" | "sell";
  type: "trade" | "liquidation";
};
type LiquidationEvent = {
  id: string;
  timestamp: string;
  price: number;
  quantity: number;
  side: "buy" | "sell";
  notional: number;
  type: string;
  source: string;
};
type HeatmapBucket = { timestamp: number; volume: number };
type CapturedMarket = {
  symbol: string;
  instrument: string;
  market: "crypto" | "index" | "equity";
  book: {
    symbol: string;
    exchange: string;
    timestamp: string;
    bids: OrderLevel[];
    asks: OrderLevel[];
    spread: number;
    spreadBps: number;
  } | null;
  bookUpdatedAt: string | null;
  bookError: string | null;
  liquidations: {
    symbol: string;
    instrument: string;
    events: LiquidationEvent[];
    heatmap: HeatmapBucket[];
  } | null;
  liquidationsUpdatedAt: string | null;
  liquidationsError: string | null;
  unavailableReason: string | null;
  liquidationEvents: LiquidationEvent[];
  depthHistory: DepthSample[];
  orderflowEvents: OrderflowEvent[];
  orderflowEventByKey: Map<string, OrderflowEvent>;
};

const unavailableMarkets: CapturedMarket[] = [
  {
    symbol: "SP500",
    instrument: "ES",
    market: "index",
    book: null,
    bookUpdatedAt: null,
    bookError: null,
    liquidations: null,
    liquidationsUpdatedAt: null,
    liquidationsError: null,
    unavailableReason: "Feed CME ES no configurado",
    liquidationEvents: [],
    depthHistory: [],
    orderflowEvents: [],
    orderflowEventByKey: new Map(),
  },
  {
    symbol: "SPX",
    instrument: "SPX",
    market: "index",
    book: null,
    bookUpdatedAt: null,
    bookError: null,
    liquidations: null,
    liquidationsUpdatedAt: null,
    liquidationsError: null,
    unavailableReason: "Índice cash; no tiene libro negociable propio",
    liquidationEvents: [],
    depthHistory: [],
    orderflowEvents: [],
    orderflowEventByKey: new Map(),
  },
  {
    symbol: "NAS100",
    instrument: "NQ",
    market: "index",
    book: null,
    bookUpdatedAt: null,
    bookError: null,
    liquidations: null,
    liquidationsUpdatedAt: null,
    liquidationsError: null,
    unavailableReason: "Feed CME NQ no configurado",
    liquidationEvents: [],
    depthHistory: [],
    orderflowEvents: [],
    orderflowEventByKey: new Map(),
  },
  {
    symbol: "NDAQ",
    instrument: "NDAQ",
    market: "equity",
    book: null,
    bookUpdatedAt: null,
    bookError: null,
    liquidations: null,
    liquidationsUpdatedAt: null,
    liquidationsError: null,
    unavailableReason: "Feed de profundidad/liquidaciones no configurado",
    liquidationEvents: [],
    depthHistory: [],
    orderflowEvents: [],
    orderflowEventByKey: new Map(),
  },
];

const markets = new Map<string, CapturedMarket>();
for (const base of CRYPTO_BASES) {
  const asset = CRYPTO_ASSETS.find((candidate) => candidate.base === base);
  if (!asset) throw new Error(`Missing crypto asset configuration for ${base}`);
  markets.set(asset.symbol, {
    symbol: asset.symbol,
    instrument: `${base}USDT`,
    market: "crypto",
    book: null,
    bookUpdatedAt: null,
    bookError: null,
    liquidations: null,
    liquidationsUpdatedAt: null,
    liquidationsError: null,
    unavailableReason: null,
    liquidationEvents: [],
    depthHistory: [],
    orderflowEvents: [],
    orderflowEventByKey: new Map(),
  });
}
for (const market of unavailableMarkets) markets.set(market.symbol, market);

const futuresSymbols = new Map(
  CRYPTO_BASES.map((base) => [`${base}USDT`, `${base}USD`]),
);

let connectionStatus: "connecting" | "live" | "reconnecting" = "connecting";
let started = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let socket: WebSocket | null = null;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseLevels(value: unknown, descending: boolean): OrderLevel[] {
  if (!Array.isArray(value)) return [];
  const levels = value.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return [];
    const price = numberValue(entry[0]);
    const quantity = numberValue(entry[1]);
    if (price === null || quantity === null || price <= 0 || quantity <= 0) return [];
    const notional = price * quantity;
    return [{ price, quantity, notional }];
  }).sort((a, b) => descending ? b.price - a.price : a.price - b.price);
  let total = 0;
  return levels.map((level) => {
    total += level.notional;
    return { ...level, total };
  });
}

function bookFromMessage(data: JsonObject, market: CapturedMarket): void {
  const bids = parseLevels(data.b, true);
  const asks = parseLevels(data.a, false);
  if (bids.length === 0 && asks.length === 0) return;
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : 0;
  const timestamp = numberValue(data.E) ?? Date.now();
  market.book = {
    symbol: market.symbol,
    exchange: "Binance USD-M Futures",
    timestamp: new Date(timestamp).toISOString(),
    bids,
    asks,
    spread,
    spreadBps: mid ? (spread / mid) * 10_000 : 0,
  };
  market.bookUpdatedAt = new Date().toISOString();
  market.bookError = null;
}

function recordLiquidation(data: JsonObject, market: CapturedMarket): void {
  const order = isRecord(data.o) ? data.o : null;
  if (!order) return;
  const price = numberValue(order.ap) ?? numberValue(order.p);
  const quantity = numberValue(order.q);
  const eventTime = numberValue(order.T) ?? numberValue(data.E) ?? Date.now();
  if (price === null || quantity === null || price <= 0 || quantity <= 0) return;
  const event: LiquidationEvent = {
    id: `${market.instrument}-${eventTime}-${price}-${quantity}`,
    timestamp: new Date(eventTime).toISOString(),
    price,
    quantity,
    side: order.S === "BUY" ? "buy" : "sell",
    notional: price * quantity,
    type: typeof order.o === "string" ? order.o : "liquidation",
    source: "Binance USD-M Futures",
  };
  if (market.liquidationEvents.some((existing) => existing.id === event.id)) return;
  market.orderflowEvents.push({
    id: event.id,
    timestamp: eventTime,
    price,
    quantity,
    notional: event.notional,
    side: event.side,
    type: "liquidation",
  });
  if (market.orderflowEvents.length > ORDERFLOW_MAX_EVENTS) {
    trimOldestOrderflowEvents(market, Math.ceil(ORDERFLOW_MAX_EVENTS / 10));
  }
  const cutoff = Date.now() - LIQUIDATION_RETENTION_MS;
  market.liquidationEvents = [...market.liquidationEvents.filter((existing) => Date.parse(existing.timestamp) >= cutoff), event];
  market.liquidationsUpdatedAt = new Date().toISOString();
  market.liquidationsError = null;
}

function recordTrade(data: JsonObject, market: CapturedMarket): boolean {
  const price = numberValue(data.p);
  const quantity = numberValue(data.q);
  const timestamp = numberValue(data.T) ?? numberValue(data.E) ?? Date.now();
  if (price === null || quantity === null || price <= 0 || quantity <= 0) return false;
  const side = data.m === true ? "sell" : "buy";
  const id = `trade-${Math.floor(timestamp / 1000)}-${price}-${side}`;
  const existing = market.orderflowEventByKey.get(id);
  if (existing) {
    existing.timestamp = timestamp;
    existing.quantity += quantity;
    existing.notional += price * quantity;
    return true;
  }
  const event: OrderflowEvent = { id, timestamp, price, quantity, notional: price * quantity, side, type: "trade" };
  market.orderflowEvents.push(event);
  market.orderflowEventByKey.set(id, event);
  if (market.orderflowEvents.length > ORDERFLOW_MAX_EVENTS) {
    trimOldestOrderflowEvents(market, Math.ceil(ORDERFLOW_MAX_EVENTS / 10));
  }
  return true;
}

function trimOldestOrderflowEvents(market: CapturedMarket, count: number): void {
  const removed = market.orderflowEvents.splice(0, count);
  for (const event of removed) market.orderflowEventByKey.delete(event.id);
}

export function processBinanceHeatmapMessage(input: unknown): boolean {
  if (!isRecord(input)) return false;
  const data = isRecord(input.data) ? input.data : input;
  const order = isRecord(data.o) ? data.o : null;
  const streamSymbol = typeof data.s === "string" ? data.s : order?.s;
  const symbol = typeof streamSymbol === "string" ? futuresSymbols.get(streamSymbol) : undefined;
  if (!symbol) return false;
  const market = markets.get(symbol);
  if (!market) return false;

  if (data.e === "depthUpdate") {
    bookFromMessage(data, market);
    return market.book !== null;
  }
  if (data.e === "forceOrder") {
    recordLiquidation(data, market);
    return true;
  }
  if (data.e === "trade" || data.e === "aggTrade") return recordTrade(data, market);
  return false;
}

export function captureOrderflowSample(now = Date.now()): void {
  const cutoff = now - ORDERFLOW_RETENTION_MS;
  for (const market of markets.values()) {
    if (market.market !== "crypto" || !market.book || !market.bookUpdatedAt) continue;
    if (now - Date.parse(market.bookUpdatedAt) > ORDERFLOW_SAMPLE_MS * 3) continue;
    const lastSample = market.depthHistory[market.depthHistory.length - 1];
    if (lastSample && now - lastSample.timestamp < ORDERFLOW_SAMPLE_MS) continue;

    market.depthHistory.push({
      timestamp: now,
      bids: market.book.bids.map(({ price, quantity }) => [price, quantity]),
      asks: market.book.asks.map(({ price, quantity }) => [price, quantity]),
    });
    const firstRecent = market.depthHistory.findIndex((sample) => sample.timestamp >= cutoff);
    if (firstRecent > 0) market.depthHistory.splice(0, firstRecent);
    if (market.depthHistory.length > ORDERFLOW_MAX_SAMPLES) {
      market.depthHistory.splice(0, market.depthHistory.length - ORDERFLOW_MAX_SAMPLES);
    }

    let expiredEvents = 0;
    while (expiredEvents < market.orderflowEvents.length && market.orderflowEvents[expiredEvents].timestamp < cutoff) {
      expiredEvents += 1;
    }
    if (expiredEvents > 0) trimOldestOrderflowEvents(market, expiredEvents);
  }
}

export function getOrderflowHistory(symbol: string) {
  const market = markets.get(symbol);
  if (!market || market.market !== "crypto") return null;
  const cutoff = Date.now() - ORDERFLOW_RETENTION_MS;
  const samples = market.depthHistory
    .filter((sample) => sample.timestamp >= cutoff)
    .map((sample) => ({
      timestamp: sample.timestamp,
      levels: [
        ...sample.bids.map(([price, quantity]) => ({ price, bidNotional: price * quantity, askNotional: 0 })),
        ...sample.asks.map(([price, quantity]) => ({ price, bidNotional: 0, askNotional: price * quantity })),
      ],
    }));
  return {
    symbol: market.symbol,
    exchange: "Binance USD-M Futures",
    retentionMs: ORDERFLOW_RETENTION_MS,
    samples,
    events: market.orderflowEvents
      .filter((event) => event.timestamp >= cutoff)
      .map(({ id, timestamp, price, notional, side, type }) => ({ id, timestamp, price, notional, side, type })),
  };
}

function liquidationHeatmap(market: CapturedMarket, now: number): HeatmapBucket[] {
  const latestBucket = Math.floor(now / LIQUIDATION_BUCKET_MS) * LIQUIDATION_BUCKET_MS;
  const buckets = new Map<number, number>();
  const cutoff = now - LIQUIDATION_RETENTION_MS;
  market.liquidationEvents = market.liquidationEvents.filter((event) => Date.parse(event.timestamp) >= cutoff);
  for (const event of market.liquidationEvents) {
    const timestamp = Math.floor(Date.parse(event.timestamp) / LIQUIDATION_BUCKET_MS) * LIQUIDATION_BUCKET_MS;
    buckets.set(timestamp, (buckets.get(timestamp) ?? 0) + event.notional);
  }
  return Array.from({ length: 288 }, (_, index) => {
    const timestamp = latestBucket - (287 - index) * LIQUIDATION_BUCKET_MS;
    return { timestamp: Math.floor(timestamp / 1000), volume: buckets.get(timestamp) ?? 0 };
  });
}

export function getHeatmapSnapshot() {
  const now = Date.now();
  return {
    capturedAt: new Date(now).toISOString(),
    connectionStatus,
    markets: [...markets.values()].map(({ liquidationEvents, ...market }) => ({
      ...market,
      liquidations: market.market === "crypto" ? {
        symbol: market.symbol,
        instrument: market.instrument,
        events: liquidationEvents.slice(-100).reverse(),
        heatmap: liquidationHeatmap(markets.get(market.symbol)!, now),
      } : null,
    })),
  };
}

function setFeedError(message: string): void {
  for (const market of markets.values()) {
    if (market.market !== "crypto") continue;
    market.bookError = message;
    market.liquidationsError = message;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  connectionStatus = "reconnecting";
  const delay = Math.min(1_000 * (2 ** reconnectAttempt), RECONNECT_MAX_MS);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect(): void {
  const streams = CRYPTO_BASES.flatMap((base) => {
    const symbol = base.toLowerCase() + "usdt";
    return [`${symbol}@depth20@100ms`, `${symbol}@trade`, `${symbol}@forceOrder`];
  });
  try {
    const nextSocket = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams.join("/")}`);
    socket = nextSocket;
    nextSocket.onopen = () => {
      connectionStatus = "live";
      reconnectAttempt = 0;
      for (const market of markets.values()) {
        if (market.market !== "crypto") continue;
        market.bookError = null;
        market.liquidationsError = null;
      }
    };
    nextSocket.onmessage = (event) => {
      try {
        const message: unknown = JSON.parse(String(event.data));
        processBinanceHeatmapMessage(message);
      } catch (error) {
        console.error("[heatmap] invalid Binance websocket message:", error);
      }
    };
    nextSocket.onerror = (event) => {
      console.error("[heatmap] Binance websocket error:", event);
    };
    nextSocket.onclose = () => {
      if (socket === nextSocket) socket = null;
      setFeedError("Feed Binance desconectado; reconectando");
      scheduleReconnect();
    };
  } catch (error) {
    setFeedError(error instanceof Error ? error.message : String(error));
    console.error("[heatmap] Binance websocket connection failed:", error);
    scheduleReconnect();
  }
}

export function startHeatmapCapture(): void {
  if (started) return;
  started = true;
  const samplingTimer = setInterval(() => captureOrderflowSample(), ORDERFLOW_SAMPLE_MS);
  samplingTimer.unref();
  connect();
}
