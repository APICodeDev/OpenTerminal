import { describe, expect, it } from "vitest";
import {
  captureOrderflowSample,
  getHeatmapSnapshot,
  getOrderflowHistory,
  processBinanceHeatmapMessage,
} from "./heatmapCapture.js";

describe("continuous market heatmap capture", () => {
  it("tracks the requested crypto markets and explicitly marks unsupported index feeds", () => {
    const snapshot = getHeatmapSnapshot();
    expect(snapshot.markets.map((market) => market.symbol)).toEqual([
      "BTCUSD", "ETHUSD", "ADAUSD", "AVAXUSD", "FILUSD", "NEARUSD", "UNIUSD", "SUIUSD", "XRPUSD", "HBARUSD",
      "RENDERUSD", "SOLUSD", "SP500", "SPX", "NAS100", "NDAQ",
    ]);
    expect(snapshot.markets.find((market) => market.symbol === "SP500")?.unavailableReason).toMatch(/CME ES/);
    expect(snapshot.markets.find((market) => market.symbol === "SPX")?.unavailableReason).toMatch(/cash/);
  });

  it("updates order-book depth and liquidation volume from Binance futures events", () => {
    const now = Date.now();
    expect(processBinanceHeatmapMessage({
      stream: "adausdt@depth20@100ms",
      data: {
        e: "depthUpdate",
        E: now,
        s: "ADAUSDT",
        b: [["0.5", "10"], ["0.6", "5"]],
        a: [["0.7", "4"]],
      },
    })).toBe(true);

    expect(processBinanceHeatmapMessage({
      stream: "adausdt@trade",
      data: { e: "trade", E: now, t: 42, s: "ADAUSDT", p: "0.61", q: "10", T: now, m: true },
    })).toBe(true);

    expect(processBinanceHeatmapMessage({
      stream: "adausdt@trade",
      data: { e: "trade", E: now + 10, t: 43, s: "ADAUSDT", p: "0.61", q: "5", T: now + 10, m: true },
    })).toBe(true);

    expect(processBinanceHeatmapMessage({
      stream: "adausdt@forceOrder",
      data: {
        e: "forceOrder",
        E: now + 100,
        o: { s: "ADAUSDT", S: "SELL", o: "LIMIT", q: "20", p: "0.55", ap: "0.54", T: now + 50 },
      },
    })).toBe(true);

    expect(processBinanceHeatmapMessage({
      stream: "adausdt@forceOrder",
      data: {
        e: "forceOrder",
        E: now + 200,
        o: { s: "ADAUSDT", S: "BUY", o: "LIMIT", q: "10", p: "0.56", ap: "0.56", T: now + 150 },
      },
    })).toBe(true);

    const ada = getHeatmapSnapshot().markets.find((market) => market.symbol === "ADAUSD");
    expect(ada?.book?.bids[0]).toMatchObject({ price: 0.6, quantity: 5, notional: 3, total: 3 });
    expect(ada?.book?.bids[1]).toMatchObject({ price: 0.5, quantity: 10, notional: 5, total: 8 });
    expect(ada?.book?.asks[0]).toMatchObject({ price: 0.7, quantity: 4, notional: 2.8 });
    const sellLiquidation = ada?.liquidations?.events.find((event) => event.side === "sell");
    const buyLiquidation = ada?.liquidations?.events.find((event) => event.side === "buy");
    expect(sellLiquidation).toMatchObject({ price: 0.54, quantity: 20, notional: 10.8 });
    expect(buyLiquidation).toMatchObject({ price: 0.56, quantity: 10 });
    expect(buyLiquidation?.notional).toBeCloseTo(5.6);
    expect(ada?.liquidations?.heatmap.some((bucket) => Math.abs(bucket.volume - 16.4) < 1e-9)).toBe(true);

    captureOrderflowSample(now + 1_000);
    const history = getOrderflowHistory("ADAUSD");
    expect(history?.samples[0].timestamp).toBe(now + 1_000);
    expect(history?.samples[0].levels).toContainEqual({ price: 0.6, bidNotional: 3, askNotional: 0 });
    const trade = history?.events.find((event) => event.type === "trade");
    const liquidation = history?.events.find((event) => event.type === "liquidation" && event.side === "sell");
    const shortLiquidation = history?.events.find((event) => event.type === "liquidation" && event.side === "buy");
    expect(trade).toMatchObject({ side: "sell", price: 0.61 });
    expect(trade?.notional).toBeCloseTo(9.15);
    expect(liquidation).toMatchObject({ side: "sell", price: 0.54, notional: 10.8 });
    expect(shortLiquidation).toMatchObject({ side: "buy", price: 0.56 });
    expect(shortLiquidation?.notional).toBeCloseTo(5.6);
  });
});
