import { describe, expect, it } from "vitest";
import { aggregateCandles } from "./candleAggregation.js";

describe("aggregateCandles", () => {
  it("rolls hourly candles into UTC-aligned three-hour OHLCV buckets", () => {
    const result = aggregateCandles([
      { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 2 },
      { time: 3600, open: 11, high: 13, low: 10, close: 12, volume: 3 },
      { time: 7200, open: 12, high: 14, low: 8, close: 13, volume: 4 },
      { time: 10800, open: 13, high: 15, low: 12, close: 14, volume: 5 },
    ], 3 * 3600);

    expect(result).toEqual([
      { time: 0, open: 10, high: 14, low: 8, close: 13, volume: 9 },
      { time: 10800, open: 13, high: 15, low: 12, close: 14, volume: 5 },
    ]);
  });
});

