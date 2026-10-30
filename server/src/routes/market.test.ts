import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { marketRouter } from "./market.js";

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function getHandler(path: string) {
  const layer = (marketRouter as any).stack.find((l: any) => l.route?.path === path);
  if (!layer) throw new Error(`no route registered for ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

describe("GET /crypto/orderbook/:symbol", () => {
  it("rejects a symbol outside the supported crypto whitelist with 400, before touching the network", async () => {
    const handler = getHandler("/crypto/orderbook/:symbol");
    const req = { params: { symbol: "AAA&limit=5000" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "unsupported crypto symbol" });
  });

  it("accepts a whitelisted symbol (case-insensitive) and proceeds past validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: [], result: { XXBTZUSD: { bids: [], asks: [] } } }),
      })
    );
    try {
      const handler = getHandler("/crypto/orderbook/:symbol");
      const req = { params: { symbol: "btc" } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.status).not.toHaveBeenCalledWith(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("GET /history/:symbol crypto intervals", () => {
  it("rejects unsupported intervals before touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const handler = getHandler("/history/:symbol");
      const req = { params: { symbol: "UNIUSD" }, query: { range: "1D", interval: "7seconds" } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "unsupported crypto interval" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("GET /crypto/heatmap", () => {
  it("returns the current server-side capture snapshot without requesting data from the client", () => {
    const handler = getHandler("/crypto/heatmap");
    const res = fakeRes();

    handler({} as Request, res, () => {});

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      connectionStatus: expect.any(String),
      markets: expect.arrayContaining([
        expect.objectContaining({ symbol: "ADAUSD", instrument: "ADAUSDT" }),
        expect.objectContaining({ symbol: "SP500", instrument: "ES", book: null }),
      ]),
    }));
  });
});

describe("GET /crypto/orderflow/:symbol", () => {
  it("returns the rolling price/time capture for a supported market", () => {
    const handler = getHandler("/crypto/orderflow/:symbol");
    const res = fakeRes();

    handler({ params: { symbol: "adausd" } } as unknown as Request, res, () => {});

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "ADAUSD",
      retentionMs: 30 * 60 * 1000,
      samples: expect.any(Array),
      events: expect.any(Array),
    }));
  });

  it("rejects symbols outside the captured crypto markets", () => {
    const handler = getHandler("/crypto/orderflow/:symbol");
    const res = fakeRes();

    handler({ params: { symbol: "SP500" } } as unknown as Request, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "unsupported crypto symbol" });
  });
});
