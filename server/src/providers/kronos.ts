export const KRONOS_TIMEFRAME_SECONDS = {
  "5m": 5 * 60,
  "15m": 15 * 60,
  "30m": 30 * 60,
  "1H": 60 * 60,
  "3H": 3 * 60 * 60,
  "4H": 4 * 60 * 60,
} as const;

export type KronosTimeframe = keyof typeof KRONOS_TIMEFRAME_SECONDS;
export type KronosModel = "mini" | "small" | "base";

export type KronosCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type KronosPredictionRequest = {
  symbol: string;
  timeframe: KronosTimeframe;
  model: KronosModel;
  lookback: number;
  predictionLength: number;
  temperature: number;
  topK: number;
  topP: number;
  sampleCount: number;
  candles: KronosCandle[];
};

export type KronosPrediction = {
  symbol: string;
  timeframe: KronosTimeframe;
  model: KronosModel;
  lastCandleTime: number;
  generatedAt: string;
  forecast: KronosCandle[];
  cached: boolean;
};

function serviceUrl(): string {
  return (process.env.KRONOS_URL ?? "http://127.0.0.1:8001").replace(/\/$/, "");
}

export async function predict(request: KronosPredictionRequest): Promise<KronosPrediction> {
  const timeoutMs = Number(process.env.KRONOS_TIMEOUT_MS ?? 300_000);
  const response = await fetch(`${serviceUrl()}/predict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...request,
      intervalSeconds: KRONOS_TIMEFRAME_SECONDS[request.timeframe],
    }),
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 300_000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Kronos service returned HTTP ${response.status}`);
  }
  return {
    ...(body as Omit<KronosPrediction, "symbol" | "timeframe">),
    symbol: request.symbol,
    timeframe: request.timeframe,
  };
}

