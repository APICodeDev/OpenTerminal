"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig } from "../../lib/api";

type Level = { price: number; quantity: number; notional: number; total: number };
type MarketRow = {
  symbol: string;
  instrument: string;
  market: "crypto" | "index" | "equity";
  book: {
    exchange: string;
    timestamp: string;
    bids: Level[];
    asks: Level[];
    spread: number;
    spreadBps: number;
  } | null;
  bookUpdatedAt: string | null;
  bookError: string | null;
  liquidations: {
    events: Array<{ id: string; timestamp: string; side: "buy" | "sell"; notional: number }>;
    heatmap: Array<{ timestamp: number; volume: number }>;
  } | null;
  liquidationsUpdatedAt: string | null;
  liquidationsError: string | null;
  unavailableReason: string | null;
};
type HeatmapResponse = {
  capturedAt: string;
  connectionStatus: "connecting" | "live" | "reconnecting";
  markets: MarketRow[];
};

function BookRow({ market, maximum }: { market: MarketRow; maximum: number }) {
  if (!market.book) {
    return (
      <div className="grid grid-cols-[68px_minmax(0,1fr)] items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
        <strong className="text-[11px]">{market.symbol}</strong>
        <span className="dim text-[10px]">{market.bookError ?? market.unavailableReason ?? "Esperando datos del feed"}</span>
      </div>
    );
  }

  const cells = (levels: Level[], side: "buy" | "sell") => levels.slice(0, 20).map((level, index) => {
    const strength = maximum > 0 ? Math.sqrt(level.notional / maximum) : 0;
    return (
      <div
        key={`${side}-${level.price}-${index}`}
        title={`${side === "buy" ? "Bid" : "Ask"} · ${fmtBig(level.notional)} USD · ${fmt(level.price, level.price < 10 ? 5 : 2)}`}
        className={`h-5 min-w-0 flex items-center justify-center overflow-hidden text-[8px] text-white ${side === "buy" ? "bg-emerald-500" : "bg-red-500"}`}
        style={{ opacity: 0.1 + strength * 0.9 }}
      >
        {fmt(level.price, level.price < 10 ? 3 : 0)}
      </div>
    );
  });

  return (
    <div className="grid grid-cols-[68px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
      <div>
        <strong className="text-[11px]">{market.symbol}</strong>
        <div className="dim text-[9px]">{market.book.spreadBps.toFixed(1)} bps</div>
      </div>
      <div className="grid grid-cols-10 gap-px">{cells(market.book.bids, "buy")}</div>
      <div className="grid grid-cols-10 gap-px">{cells(market.book.asks, "sell")}</div>
    </div>
  );
}

function liquidationBins(market: MarketRow): Array<{ timestamp: number; volume: number }> {
  const buckets = market.liquidations?.heatmap ?? [];
  return Array.from({ length: 48 }, (_, index) => {
    const slice = buckets.slice(index * 6, index * 6 + 6);
    return {
      timestamp: slice[0]?.timestamp ?? 0,
      volume: slice.reduce((sum, bucket) => sum + bucket.volume, 0),
    };
  });
}

function LiquidationRow({ market, maximum }: { market: MarketRow; maximum: number }) {
  if (!market.liquidations) {
    return (
      <div className="grid grid-cols-[68px_minmax(0,1fr)] items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
        <strong className="text-[11px]">{market.symbol}</strong>
        <span className="dim text-[10px]">{market.liquidationsError ?? market.unavailableReason ?? "Esperando datos del feed"}</span>
      </div>
    );
  }

  const bins = liquidationBins(market);
  return (
    <div className="grid grid-cols-[68px_minmax(0,1fr)] items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
      <div>
        <strong className="text-[11px]">{market.symbol}</strong>
        <div className="dim text-[9px]">{fmtBig(bins.reduce((sum, bin) => sum + bin.volume, 0))}</div>
      </div>
      <div className="grid grid-cols-[repeat(48,minmax(0,1fr))] gap-px">
        {bins.map((bin, index) => {
          const firstBucket = market.liquidations!.heatmap[index * 6];
          const strength = maximum > 0 ? Math.sqrt(bin.volume / maximum) : 0;
          return (
            <div
              key={bin.timestamp || index}
              title={`${firstBucket ? new Date(firstBucket.timestamp * 1000).toLocaleString() : ""} · ${fmtBig(bin.volume)} USD`}
              className="h-5 min-w-0 bg-[var(--amber)]"
              style={{ opacity: bin.volume ? 0.12 + strength * 0.88 : 0.05 }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function OrderflowHeatmapWidget() {
  const [showBooks, setShowBooks] = useState(true);
  const [showLiquidations, setShowLiquidations] = useState(true);
  const { data, error } = useQuery({
    queryKey: ["orderflow-heatmap"],
    queryFn: () => apiGet<HeatmapResponse>("/api/crypto/heatmap"),
    refetchInterval: 1_000,
  });
  const markets = data?.markets ?? [];
  const cryptoMarkets = markets.filter((market) => market.market === "crypto");
  const bookMaximum = useMemo(
    () => Math.max(0, ...cryptoMarkets.flatMap((market) => [...(market.book?.bids ?? []), ...(market.book?.asks ?? [])].map((level) => level.notional))),
    [cryptoMarkets],
  );
  const liquidationMaximum = useMemo(
    () => Math.max(0, ...cryptoMarkets.flatMap((market) => liquidationBins(market).map((bin) => bin.volume))),
    [cryptoMarkets],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--border)] p-2 text-[10px]">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={showBooks} onChange={(event) => setShowBooks(event.target.checked)} />
          <span>Libro de órdenes</span>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={showLiquidations} onChange={(event) => setShowLiquidations(event.target.checked)} />
          <span>Liquidaciones</span>
        </label>
        <span className={`ml-auto ${data?.connectionStatus === "live" ? "up" : "text-[var(--amber)]"}`}>
          {data?.connectionStatus === "live" ? "● Binance Futures LIVE" : data?.connectionStatus === "reconnecting" ? "● Reconectando feed" : "○ Conectando feed"}
        </span>
      </div>

      {error && <div className="px-2 py-1 text-[10px] down">Error de lectura: {error.message}</div>}
      {!data && !error && <div className="p-2 text-[10px] dim">Esperando captura del servidor…</div>}

      <div className="min-h-0 flex-1 overflow-auto">
        {showBooks && (
          <section>
            <div className="sticky top-0 z-[1] grid grid-cols-[68px_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[9px] dim">
              <span>ACTIVO</span><span className="up">BIDS · profundidad USD</span><span className="down">ASKS · profundidad USD</span>
            </div>
            {markets.map((market) => <BookRow key={`book-${market.symbol}`} market={market} maximum={bookMaximum} />)}
          </section>
        )}

        {showLiquidations && (
          <section>
            <div className="sticky top-0 z-[1] grid grid-cols-[68px_minmax(0,1fr)] gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[9px] dim">
              <span>ACTIVO</span><span>VOLUMEN LIQUIDADO · ÚLTIMAS 24 H · 30 MIN / CELDA (USD)</span>
            </div>
            {markets.map((market) => <LiquidationRow key={`liquidations-${market.symbol}`} market={market} maximum={liquidationMaximum} />)}
          </section>
        )}
      </div>
      <div className="border-t border-[var(--border)] px-2 py-1 text-[9px] dim">
        Captura en el servidor independiente de estas casillas. Liquidaciones recientes desde el arranque del feed; profundidad en tiempo real.
      </div>
    </div>
  );
}
