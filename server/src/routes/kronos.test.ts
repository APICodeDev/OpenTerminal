import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { kronosRouter } from "./kronos.js";

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function handler() {
  return (kronosRouter as any).stack[0].route.stack[0].handle as (req: Request, res: Response) => unknown;
}

const candles = Array.from({ length: 32 }, (_, index) => ({
  time: 1_700_000_000 + index * 300,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 10,
}));

afterEach(() => vi.unstubAllGlobals());

describe("POST /kronos/predict", () => {
  it("rejects timeframes below five minutes without calling the inference service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = fakeRes();
    await handler()({ body: {
      symbol: "BTCUSD", timeframe: "1m", model: "mini", lookback: 32,
      predictionLength: 12, temperature: 1, topK: 0, topP: 0.9, sampleCount: 1, candles,
    } } as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a valid request with the selected candle duration", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: "mini", lastCandleTime: candles.at(-1)!.time, generatedAt: "now", forecast: [], cached: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = fakeRes();
    await handler()({ body: {
      symbol: "BTCUSD", timeframe: "5m", model: "mini", lookback: 32,
      predictionLength: 12, temperature: 1, topK: 0, topP: 0.9, sampleCount: 1, candles,
    } } as Request, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ intervalSeconds: 300 });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ symbol: "BTCUSD", timeframe: "5m" }));
  });
});

