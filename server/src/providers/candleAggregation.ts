export type AggregatableCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function aggregateCandles<T extends AggregatableCandle>(candles: T[], bucketSeconds: number): AggregatableCandle[] {
  const buckets = new Map<number, AggregatableCandle>();
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
  return [...buckets.values()];
}

