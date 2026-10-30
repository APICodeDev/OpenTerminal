"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig, pctClass } from "../../lib/api";
import Flash from "../Flash";
import { useTerminal } from "../../store/terminal";

type CryptoRow = {
  id: string; symbol: string; name: string; price: number | null;
  changePercent24h: number | null; marketCap: number | null; volume24h: number | null;
  rank: number | null; sparkline: number[];
};
type GlobalStats = { totalMarketCap: number; btcDominance: number; ethDominance: number };

// Feeds can report a null/NaN price for newly-listed or delisted assets.
function fmtPrice(p: number | null): string {
  if (p === null || !isFinite(p)) return "—";
  return p >= 1 ? fmt(p) : p.toPrecision(4);
}

export default function CryptoWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const { data = [], error } = useQuery({
    queryKey: ["crypto"],
    queryFn: () => apiGet<CryptoRow[]>("/api/crypto"),
    refetchInterval: 1_000,
  });
  const { data: global } = useQuery({
    queryKey: ["crypto-global"],
    queryFn: () => apiGet<GlobalStats>("/api/crypto/global"),
    refetchInterval: 30_000,
  });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;

  return (
    <div>
      {global && (
        <div className="flex gap-4 px-2 py-1 border-b border-[var(--border)] dim">
          <span>Total MCap <span className="text-[var(--text)]">{fmtBig(global.totalMarketCap)}</span></span>
          <span>BTC.D <span className="amber">{fmt(global.btcDominance, 1)}%</span></span>
          <span>ETH.D <span className="amber">{fmt(global.ethDominance, 1)}%</span></span>
        </div>
      )}
      <table className="data-table">
        <thead>
          <tr><th>#</th><th>Par USD</th><th>Precio</th><th>24h%</th><th>Vol 24h USD</th><th>Fuente</th></tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id} onClick={() => setActiveSymbol(c.symbol)}>
              <td className="dim">{c.rank ?? "—"}</td>
              <td className="!text-left"><span className="font-bold">{c.symbol}</span> <span className="dim">{c.name}</span></td>
              <td><Flash value={c.price}>{fmtPrice(c.price)}</Flash></td>
              <td className={pctClass(c.changePercent24h)}>
                <Flash value={c.changePercent24h}>{fmt(c.changePercent24h)}%</Flash>
              </td>
              <td>{fmtBig(c.volume24h)}</td>
              <td className="dim">Kraken</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
