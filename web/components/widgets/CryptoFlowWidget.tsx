"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, fmt, fmtBig } from "../../lib/api";
import { cryptoUsdSymbol, krakenWsSymbol } from "../../lib/crypto";
import { type WidgetInstance, useWidgetSymbol } from "../../store/terminal";

type Level = { price: number; quantity: number; notional: number; total: number };
type Book = {
  symbol: string; exchange: string; timestamp: string;
  bids: Level[]; asks: Level[]; spread: number; spreadBps: number;
};
type Trade = {
  id: string; timestamp: string; price: number; quantity: number;
  side: "buy" | "sell"; notional: number;
};
type Liquidation = Trade & { type: string; source: string };
type LiquidationData = {
  symbol: string; instrument: string | null; events: Liquidation[];
  heatmap: Array<{ timestamp: number; volume: number }>;
};
type KrakenStatus = { exchange: string; configured: boolean; liveTradingEnabled: boolean };
type Tab = "book" | "flow" | "liquidations" | "trade";

function rebuildLevels(rows: Array<{ price: number; quantity?: number; qty?: number }>, side: "bid" | "ask"): Level[] {
  let total = 0;
  return rows
    .map((row) => ({ price: Number(row.price), quantity: Number(row.quantity ?? row.qty ?? 0) }))
    .filter((row) => row.quantity > 0)
    .sort((a, b) => side === "bid" ? b.price - a.price : a.price - b.price)
    .slice(0, 100)
    .map((row) => {
      const notional = row.price * row.quantity;
      total += notional;
      return { ...row, notional, total };
    });
}

function mergeLevels(current: Level[], updates: Array<{ price: number; qty: number }>, side: "bid" | "ask"): Level[] {
  const levels = new Map(current.map((row) => [row.price, row.quantity]));
  for (const row of updates) {
    if (Number(row.qty) === 0) levels.delete(Number(row.price));
    else levels.set(Number(row.price), Number(row.qty));
  }
  return rebuildLevels([...levels].map(([price, quantity]) => ({ price, quantity })), side);
}

function DepthRow({ row, max, side }: { row: Level; max: number; side: "buy" | "sell" }) {
  const width = Math.max(1, (row.notional / max) * 100);
  return (
    <div className="relative grid grid-cols-3 gap-1 px-2 py-[2px] text-[10px] overflow-hidden">
      <div
        className={`absolute inset-y-0 ${side === "buy" ? "right-0 bg-emerald-500/15" : "left-0 bg-red-500/15"}`}
        style={{ width: `${width}%` }}
      />
      <span className={`relative ${side === "buy" ? "up" : "down"}`}>{fmt(row.price, row.price < 10 ? 4 : 2)}</span>
      <span className="relative text-right">{fmt(row.quantity, 4)}</span>
      <span className="relative text-right dim">{fmtBig(row.notional)}</span>
    </div>
  );
}

function DepthTable({ book }: { book?: Book }) {
  if (!book) return <div className="p-2 dim">Cargando libro de órdenes…</div>;
  const bids = book.bids.slice(0, 18);
  const asks = book.asks.slice(0, 18);
  const max = Math.max(...bids.map((row) => row.notional), ...asks.map((row) => row.notional), 1);
  return (
    <div>
      <div className="grid grid-cols-2 border-b border-[var(--border)]">
        <div className="px-2 py-1"><span className="up">BIDS</span> · compra</div>
        <div className="px-2 py-1 border-l border-[var(--border)]"><span className="down">ASKS</span> · venta</div>
      </div>
      <div className="grid grid-cols-2">
        <div>{bids.map((row) => <DepthRow key={row.price} row={row} max={max} side="buy" />)}</div>
        <div className="border-l border-[var(--border)]">{asks.map((row) => <DepthRow key={row.price} row={row} max={max} side="sell" />)}</div>
      </div>
    </div>
  );
}

function OrderHeatmap({ book }: { book?: Book }) {
  const cells = useMemo(() => {
    if (!book) return [];
    return [
      ...book.asks.slice(0, 30).reverse().map((row) => ({ ...row, side: "sell" as const })),
      ...book.bids.slice(0, 30).map((row) => ({ ...row, side: "buy" as const })),
    ];
  }, [book]);
  const max = Math.max(...cells.map((cell) => cell.notional), 1);
  if (!book) return null;
  return (
    <div className="p-2">
      <div className="flex justify-between dim mb-1"><span>Mapa de liquidez por nivel</span><span>USD nocional</span></div>
      <div className="grid grid-cols-10 gap-[2px]">
        {cells.map((cell) => {
          const strength = 0.12 + 0.88 * Math.sqrt(cell.notional / max);
          return (
            <div
              key={`${cell.side}-${cell.price}`}
              title={`${cell.side === "buy" ? "Compra" : "Venta"} ${fmtBig(cell.notional)} USD @ ${cell.price}`}
              className={`h-7 flex items-center justify-center text-[8px] text-white/80 ${cell.side === "buy" ? "bg-emerald-500" : "bg-red-500"}`}
              style={{ opacity: strength }}
            >
              {fmt(cell.price, cell.price < 10 ? 3 : 0)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TradeFlow({ trades }: { trades: Trade[] }) {
  const buys = trades.filter((trade) => trade.side === "buy").reduce((sum, trade) => sum + trade.notional, 0);
  const sells = trades.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + trade.notional, 0);
  const total = buys + sells || 1;
  return (
    <div>
      <div className="p-2 border-b border-[var(--border)]">
        <div className="flex justify-between mb-1"><span className="up">Compras {fmtBig(buys)}</span><span className="down">Ventas {fmtBig(sells)}</span></div>
        <div className="h-2 flex bg-[#222]"><div className="bg-emerald-500" style={{ width: `${(buys / total) * 100}%` }} /><div className="bg-red-500" style={{ width: `${(sells / total) * 100}%` }} /></div>
      </div>
      <table className="data-table">
        <thead><tr><th>Hora</th><th>Lado agresor</th><th>Precio</th><th>Cantidad</th><th>USD</th></tr></thead>
        <tbody>{trades.slice(0, 60).map((trade) => (
          <tr key={trade.id}>
            <td>{new Date(trade.timestamp).toLocaleTimeString()}</td>
            <td className={trade.side === "buy" ? "up" : "down"}>{trade.side === "buy" ? "COMPRA" : "VENTA"}</td>
            <td>{fmt(trade.price, trade.price < 10 ? 4 : 2)}</td><td>{fmt(trade.quantity, 5)}</td><td>{fmtBig(trade.notional)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Liquidations({ data }: { data?: LiquidationData }) {
  if (!data) return <div className="p-2 dim">Cargando liquidaciones…</div>;
  const max = Math.max(...data.heatmap.map((bucket) => bucket.volume), 1);
  return (
    <div>
      <div className="p-2 border-b border-[var(--border)]">
        <div className="flex justify-between dim mb-1"><span>Volumen liquidado · intervalos 5 min</span><span>{data.instrument ?? "Sin futuro Kraken"}</span></div>
        <div className="h-24 flex items-end gap-[1px]">
          {data.heatmap.slice(-96).map((bucket) => (
            <div key={bucket.timestamp} className="flex-1 bg-[var(--amber)] min-w-[2px]" style={{ height: `${Math.max(2, (bucket.volume / max) * 100)}%`, opacity: bucket.volume ? 0.85 : 0.08 }} title={`${new Date(bucket.timestamp * 1000).toLocaleString()} · ${fmt(bucket.volume, 4)}`} />
          ))}
        </div>
      </div>
      <div className="px-2 py-1 dim">Libro de ejecuciones por liquidación · Kraken Futures</div>
      {data.events.length === 0 ? (
        <div className="p-3 dim">No hay liquidaciones entre las 100 ejecuciones más recientes. El mapa superior conserva el volumen agregado de 24h.</div>
      ) : (
        <table className="data-table"><thead><tr><th>Hora</th><th>Lado</th><th>Precio</th><th>Cantidad</th><th>USD</th></tr></thead>
          <tbody>{data.events.map((event) => <tr key={event.id}><td>{new Date(event.timestamp).toLocaleTimeString()}</td><td className={event.side === "buy" ? "up" : "down"}>{event.side.toUpperCase()}</td><td>{fmt(event.price)}</td><td>{fmt(event.quantity, 5)}</td><td>{fmtBig(event.notional)}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

function TradeTicket({ symbol, status }: { symbol: string; status?: KrakenStatus }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("limit");
  const [volume, setVolume] = useState("");
  const [price, setPrice] = useState("");
  const [live, setLive] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const balances = useQuery({
    queryKey: ["kraken-balances"],
    queryFn: () => apiGet<Record<string, string>>("/api/kraken/balances"),
    enabled: status?.configured === true,
    refetchInterval: 15_000,
  });
  const orders = useQuery({
    queryKey: ["kraken-open-orders"],
    queryFn: () => apiGet<{ open?: Record<string, { descr?: { pair?: string; type?: string; ordertype?: string; price?: string }; vol?: string; vol_exec?: string; status?: string }> }>("/api/kraken/orders"),
    enabled: status?.configured === true,
    refetchInterval: 10_000,
  });
  const mutation = useMutation({
    mutationFn: () => apiPost<Record<string, unknown>>("/api/kraken/orders", {
      symbol, side, orderType, volume: Number(volume), price: orderType === "limit" ? Number(price) : undefined,
      validate: !live, confirmation,
    }),
    onSuccess: () => { void orders.refetch(); void balances.refetch(); },
  });
  const cancel = useMutation({
    mutationFn: (txid: string) => apiDelete(`/api/kraken/orders/${encodeURIComponent(txid)}`),
    onSuccess: () => void orders.refetch(),
  });
  const nonZeroBalances = Object.entries(balances.data ?? {}).filter(([, value]) => Number(value) !== 0).slice(0, 10);
  const openOrders = Object.entries(orders.data?.open ?? {});
  return (
    <div className="p-3 max-w-lg">
      <div className="mb-3 flex gap-2 items-center"><span className={status?.configured ? "up" : "down"}>{status?.configured ? "KRAKEN CONECTADO" : "KRAKEN SIN CLAVES"}</span><span className="dim">·</span><span className={status?.liveTradingEnabled ? "text-[var(--amber)]" : "dim"}>{status?.liveTradingEnabled ? "LIVE HABILITADO" : "LIVE BLOQUEADO"}</span></div>
      <div className="grid grid-cols-2 gap-2">
        <select value={side} onChange={(event) => setSide(event.target.value as "buy" | "sell")}><option value="buy">Comprar</option><option value="sell">Vender</option></select>
        <select value={orderType} onChange={(event) => setOrderType(event.target.value as "market" | "limit")}><option value="limit">Límite</option><option value="market">Mercado</option></select>
        <label className="dim">Cantidad {symbol.slice(0, -3)}<input value={volume} onChange={(event) => setVolume(event.target.value)} inputMode="decimal" placeholder="0.00" className="w-full mt-1" /></label>
        {orderType === "limit" && <label className="dim">Precio USD<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="0.00" className="w-full mt-1" /></label>}
      </div>
      <label className="flex gap-2 items-center mt-3"><input type="checkbox" checked={live} disabled={!status?.liveTradingEnabled} onChange={(event) => setLive(event.target.checked)} /><span>{live ? "Enviar orden REAL" : "Sólo validar (no ejecuta)"}</span></label>
      {live && <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder='Escribe "OPERAR EN KRAKEN"' className="w-full mt-2" />}
      <button className="term-btn active mt-3" disabled={!status?.configured || mutation.isPending || !volume || (orderType === "limit" && !price)} onClick={() => mutation.mutate()}>{mutation.isPending ? "ENVIANDO…" : live ? "CONFIRMAR ORDEN REAL" : "VALIDAR ORDEN"}</button>
      {mutation.error && <div className="down mt-2">{mutation.error.message}</div>}
      {mutation.data && <pre className="mt-2 p-2 bg-black/30 overflow-auto text-[10px]">{JSON.stringify(mutation.data, null, 2)}</pre>}
      <p className="dim mt-3">La ejecución real requiere el flag del servidor y la frase de confirmación. Las claves nunca llegan al navegador.</p>
      {nonZeroBalances.length > 0 && <div className="mt-4 border-t border-[var(--border)] pt-2"><div className="dim mb-1">SALDOS KRAKEN</div><div className="flex flex-wrap gap-2">{nonZeroBalances.map(([asset, value]) => <span key={asset} className="px-2 py-1 bg-black/30">{asset} {fmt(Number(value), 6)}</span>)}</div></div>}
      <div className="mt-4 border-t border-[var(--border)] pt-2">
        <div className="dim mb-1">ÓRDENES ABIERTAS</div>
        {openOrders.length === 0 ? <div className="dim">Sin órdenes abiertas.</div> : (
          <table className="data-table"><thead><tr><th>Par</th><th>Lado</th><th>Tipo</th><th>Volumen</th><th>Precio</th><th></th></tr></thead><tbody>
            {openOrders.map(([txid, order]) => <tr key={txid}><td>{order.descr?.pair ?? "—"}</td><td>{order.descr?.type ?? "—"}</td><td>{order.descr?.ordertype ?? "—"}</td><td>{order.vol ?? "—"}</td><td>{order.descr?.price ?? "—"}</td><td><button className="term-btn" disabled={!status?.liveTradingEnabled || cancel.isPending} onClick={() => cancel.mutate(txid)}>CANCELAR</button></td></tr>)}
          </tbody></table>
        )}
        {cancel.error && <div className="down mt-1">{cancel.error.message}</div>}
      </div>
    </div>
  );
}

export default function CryptoFlowWidget({ widget }: { widget: WidgetInstance }) {
  const linkedSymbol = useWidgetSymbol(widget);
  const symbol = cryptoUsdSymbol(linkedSymbol);
  const [tab, setTab] = useState<Tab>("book");
  const [book, setBook] = useState<Book>();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [socketState, setSocketState] = useState<"connecting" | "live" | "fallback">("connecting");
  const bookQuery = useQuery({ queryKey: ["crypto-book", symbol], queryFn: () => apiGet<Book>(`/api/crypto/orderbook/${symbol}`), refetchInterval: socketState === "live" ? 10_000 : 1_000 });
  const tradeQuery = useQuery({ queryKey: ["crypto-trades", symbol], queryFn: () => apiGet<Trade[]>(`/api/crypto/trades/${symbol}`), refetchInterval: socketState === "live" ? 10_000 : 1_000 });
  const liquidationQuery = useQuery({ queryKey: ["crypto-liquidations", symbol], queryFn: () => apiGet<LiquidationData>(`/api/crypto/liquidations/${symbol}`), refetchInterval: 5_000 });
  const statusQuery = useQuery({ queryKey: ["kraken-status"], queryFn: () => apiGet<KrakenStatus>("/api/kraken/status"), staleTime: 30_000 });

  useEffect(() => { if (bookQuery.data) setBook(bookQuery.data); }, [bookQuery.data]);
  useEffect(() => { if (tradeQuery.data) setTrades(tradeQuery.data); }, [tradeQuery.data]);

  useEffect(() => {
    setSocketState("connecting");
    const ws = new WebSocket("wss://ws.kraken.com/v2");
    const wsSymbol = krakenWsSymbol(symbol);
    const timeout = window.setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) { setSocketState("fallback"); ws.close(); } }, 5_000);
    ws.onopen = () => {
      window.clearTimeout(timeout);
      ws.send(JSON.stringify({ method: "subscribe", params: { channel: "book", symbol: [wsSymbol], depth: 100 }, req_id: 1 }));
      ws.send(JSON.stringify({ method: "subscribe", params: { channel: "trade", symbol: [wsSymbol], snapshot: true }, req_id: 2 }));
      setSocketState("live");
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.channel === "book" && message.data?.[0]) {
          const update = message.data[0];
          setBook((current) => {
            const base: Book = current ?? { symbol, exchange: "Kraken", timestamp: new Date().toISOString(), bids: [], asks: [], spread: 0, spreadBps: 0 };
            const bids = message.type === "snapshot" ? rebuildLevels(update.bids ?? [], "bid") : mergeLevels(base.bids, update.bids ?? [], "bid");
            const asks = message.type === "snapshot" ? rebuildLevels(update.asks ?? [], "ask") : mergeLevels(base.asks, update.asks ?? [], "ask");
            const spread = (asks[0]?.price ?? 0) - (bids[0]?.price ?? 0);
            const mid = ((asks[0]?.price ?? 0) + (bids[0]?.price ?? 0)) / 2;
            return { ...base, bids, asks, spread, spreadBps: mid ? spread / mid * 10_000 : 0, timestamp: update.timestamp ?? new Date().toISOString() };
          });
        }
        if (message.channel === "trade" && Array.isArray(message.data)) {
          const incoming: Trade[] = message.data.map((row: { trade_id: string; timestamp: string; price: number; qty: number; side: string }) => ({ id: String(row.trade_id), timestamp: row.timestamp, price: Number(row.price), quantity: Number(row.qty), side: row.side === "buy" ? "buy" : "sell", notional: Number(row.price) * Number(row.qty) }));
          setTrades((current) => [...incoming.reverse(), ...current].slice(0, 100));
        }
      } catch { /* keep the last valid external snapshot */ }
    };
    ws.onerror = () => setSocketState("fallback");
    ws.onclose = () => setSocketState((state) => state === "connecting" ? "fallback" : state);
    return () => { window.clearTimeout(timeout); ws.close(); };
  }, [symbol]);

  const tabs: Array<[Tab, string]> = [["book", "LIBRO / MAPA"], ["flow", "COMPRAS / VENTAS"], ["liquidations", "LIQUIDACIONES"], ["trade", "OPERAR"]];
  return (
    <div>
      <div className="flex items-center gap-1 p-1 border-b border-[var(--border)] sticky top-0 bg-[var(--panel)] z-10">
        {tabs.map(([value, label]) => <button key={value} className={`term-btn ${tab === value ? "active" : ""}`} onClick={() => setTab(value)}>{label}</button>)}
        <span className={`ml-auto px-2 text-[10px] ${socketState === "live" ? "up" : socketState === "fallback" ? "text-[var(--amber)]" : "dim"}`}>{socketState === "live" ? "● WS LIVE" : socketState === "fallback" ? "● REST 1s" : "○ CONECTANDO"}</span>
      </div>
      <div className="px-2 py-1 flex gap-3 border-b border-[var(--border)]"><strong>{symbol}</strong><span className="dim">Kraken USD</span>{book && <><span>spread {fmt(book.spread, book.spread < 1 ? 4 : 2)}</span><span className="dim">{fmt(book.spreadBps, 2)} bps</span></>}</div>
      {(bookQuery.error || tradeQuery.error) && <div className="p-2 down">Error de feed; reintentando automáticamente.</div>}
      {tab === "book" && <><OrderHeatmap book={book} /><DepthTable book={book} /></>}
      {tab === "flow" && <TradeFlow trades={trades} />}
      {tab === "liquidations" && <Liquidations data={liquidationQuery.data} />}
      {tab === "trade" && <TradeTicket symbol={symbol} status={statusQuery.data} />}
    </div>
  );
}
