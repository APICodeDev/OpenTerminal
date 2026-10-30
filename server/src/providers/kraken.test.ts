import { afterEach, describe, expect, it, vi } from "vitest";
import { addOrder, history } from "./kraken.js";

const originalFlag = process.env.KRAKEN_LIVE_TRADING_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.KRAKEN_LIVE_TRADING_ENABLED;
  else process.env.KRAKEN_LIVE_TRADING_ENABLED = originalFlag;
  vi.unstubAllGlobals();
});

describe("Kraken live-order safety gate", () => {
  it("blocks a real order before any network call when live trading is disabled", async () => {
    process.env.KRAKEN_LIVE_TRADING_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => addOrder({ symbol: "UNIUSD", side: "buy", orderType: "market", volume: 1 }))
      .toThrow(/disabled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Kraken custom candle intervals", () => {
  it("builds 3H candles from Kraken 1H OHLC data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: [],
        result: {
          UNIUSD: [
            [0, "1", "2", "0.5", "1.5", "0", "10", 1],
            [3600, "1.5", "3", "1", "2", "0", "5", 1],
            [7200, "2", "4", "1.8", "3", "0", "7", 1],
            [10800, "3", "5", "2.5", "4", "0", "8", 1],
          ],
          last: 10800,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const candles = await history("UNIUSD", "1M", "3H");

    expect(String(fetchMock.mock.calls[0][0])).toContain("interval=60");
    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({ time: 0, open: 1, high: 4, low: 0.5, close: 3, volume: 22 });
  });

  it("builds true 1-second OHLCV candles from public trades", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: [],
        result: {
          UNIUSD: [
            ["10", "2", 1000.1, "b", "l", ""],
            ["12", "1", 1000.8, "s", "l", ""],
            ["11", "3", 1001.2, "b", "m", ""],
          ],
          last: "1001",
        },
      }),
    }));

    const candles = await history("UNIUSD", "1D", "1s");

    expect(candles).toEqual([
      { time: 1000, open: 10, high: 12, low: 10, close: 12, volume: 3 },
      { time: 1001, open: 11, high: 11, low: 11, close: 11, volume: 3 },
    ]);
  });
});
