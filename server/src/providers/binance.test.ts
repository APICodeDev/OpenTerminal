import { afterEach, describe, expect, it, vi } from "vitest";
import { futuresHistory, history, orderBook, quote } from "./binance.js";

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("binance provider URL encoding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes query-string-breaking characters in orderBook's symbol", async () => {
    const fetchMock = mockFetchOnce({ bids: [], asks: [] });
    await orderBook("AAA&limit=5000");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain("&limit=5000USDT");
    expect(url).toContain("symbol=" + encodeURIComponent("AAA&limit=5000".toUpperCase() + "USDT"));
    // exactly one `&` (the intended separator before &limit=20) survives unescaped
    expect(url.split("&").length).toBe(2);
  });

  it("encodes the symbol in quote()", async () => {
    const fetchMock = mockFetchOnce({
      lastPrice: "1", priceChange: "0", priceChangePercent: "0", openPrice: "1",
      highPrice: "1", lowPrice: "1", prevClosePrice: "1", bidPrice: "1", askPrice: "1", volume: "1",
    });
    await quote("AAA#bogus");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent("AAA#bogus".toUpperCase() + "USDT"));
    expect(url).not.toContain("#bogus");
  });

  it("encodes the symbol in history()", async () => {
    const fetchMock = mockFetchOnce([]);
    await history("AAA&x=1", "6M");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent("AAA&x=1".toUpperCase() + "USDT"));
    expect(url.split("&").length).toBe(3); // symbol, interval, limit only
  });

  it("loads chart candles from the same USD-M venue as the heatmap", async () => {
    const fetchMock = mockFetchOnce([[1_700_000_000_000, "100", "110", "90", "105", "12"]]);
    const candles = await futuresHistory("BTCUSD", "1D", "1m");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("fapi.binance.com/fapi/v1/klines");
    expect(url).toContain("symbol=BTCUSDT");
    expect(url).toContain("interval=1m");
    expect(candles[0]).toEqual({ time: 1_700_000_000, open: 100, high: 110, low: 90, close: 105, volume: 12 });
  });
});
