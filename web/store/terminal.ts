"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeSymbol } from "../lib/symbol";

export type WidgetType =
  | "quote"
  | "chart"
  | "watchlist"
  | "news"
  | "heatmap"
  | "screener"
  | "crypto"
  | "cryptoFlow"
  | "orderflowHeatmap"
  | "macro"
  | "options"
  | "portfolio"
  | "ai"
  | "calendar"
  | "insider"
  | "tv"
  | "recap"
  | "kronos";

export type ChartTimeframe = "AUTO" | "4H" | "3H" | "1H" | "30m" | "15m" | "5m" | "1m" | "10s" | "1s";
export type KronosTimeframe = "4H" | "3H" | "1H" | "30m" | "15m" | "5m";
export type KronosModel = "mini" | "small" | "base";

export type KronosSettings = {
  enabled: boolean;
  model: KronosModel;
  lookback: number;
  predictionLength: number;
  temperature: number;
  topK: number;
  topP: number;
  sampleCount: number;
};

export type KronosRuntime = {
  status: "idle" | "paused" | "loading" | "ready" | "error";
  generatedAt: string | null;
  error: string | null;
};

export type WidgetInstance = {
  id: string;
  type: WidgetType;
  symbol?: string;
  linked: boolean; // follows the globally active symbol
};

export type LayoutItem = { i: string; x: number; y: number; w: number; h: number };

type TerminalState = {
  activeSymbol: string;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  watchlist: string[];
  commandOpen: boolean;
  primaryChart: { symbol: string; timeframe: ChartTimeframe };
  kronos: KronosSettings;
  kronosRuntime: KronosRuntime;
  setActiveSymbol: (s: string) => void;
  setCommandOpen: (open: boolean) => void;
  addWidget: (type: WidgetType, symbol?: string) => void;
  removeWidget: (id: string) => void;
  setWidgetSymbol: (id: string, symbol: string) => void;
  toggleLinked: (id: string) => void;
  setLayout: (layout: LayoutItem[]) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  resetWorkspace: () => void;
  setPrimaryChart: (chart: { symbol: string; timeframe: ChartTimeframe }) => void;
  setKronos: (settings: Partial<KronosSettings>) => void;
  setKronosRuntime: (runtime: Partial<KronosRuntime>) => void;
};

export const DEFAULT_KRONOS_SETTINGS: KronosSettings = {
  enabled: false,
  model: "mini",
  lookback: 256,
  predictionLength: 12,
  temperature: 1,
  topK: 0,
  topP: 0.9,
  sampleCount: 1,
};

export const KRONOS_MAX_CONTEXT: Record<KronosModel, number> = {
  mini: 2048,
  small: 512,
  base: 512,
};

export function isKronosTimeframe(value: ChartTimeframe): value is KronosTimeframe {
  return value === "5m" || value === "15m" || value === "30m" || value === "1H" || value === "3H" || value === "4H";
}

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "w-chart", type: "chart", linked: true },
  { id: "w-quote", type: "quote", linked: true },
  { id: "w-crypto-flow", type: "cryptoFlow", linked: true },
  { id: "w-crypto", type: "crypto", linked: false },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "w-chart", x: 0, y: 0, w: 7, h: 12 },
  { i: "w-quote", x: 7, y: 0, w: 5, h: 6 },
  { i: "w-crypto-flow", x: 7, y: 6, w: 5, h: 16 },
  { i: "w-crypto", x: 0, y: 12, w: 7, h: 10 },
];

const SIZE_BY_TYPE: Record<WidgetType, { w: number; h: number }> = {
  quote: { w: 5, h: 6 },
  chart: { w: 7, h: 12 },
  watchlist: { w: 4, h: 7 },
  news: { w: 5, h: 8 },
  heatmap: { w: 7, h: 10 },
  screener: { w: 12, h: 9 },
  crypto: { w: 6, h: 9 },
  cryptoFlow: { w: 8, h: 14 },
  orderflowHeatmap: { w: 12, h: 14 },
  macro: { w: 5, h: 7 },
  options: { w: 12, h: 9 },
  portfolio: { w: 7, h: 8 },
  ai: { w: 5, h: 10 },
  calendar: { w: 12, h: 11 },
  insider: { w: 7, h: 9 },
  tv: { w: 6, h: 11 },
  recap: { w: 5, h: 12 },
  kronos: { w: 5, h: 12 },
};

export const useTerminal = create<TerminalState>()(
  persist(
    (set) => ({
      activeSymbol: "BTCUSD",
      widgets: DEFAULT_WIDGETS,
      layout: DEFAULT_LAYOUT,
      watchlist: ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "DOGEUSD", "ADAUSD", "AVAXUSD", "UNIUSD"],
      commandOpen: false,
      primaryChart: { symbol: "BTCUSD", timeframe: "AUTO" },
      kronos: DEFAULT_KRONOS_SETTINGS,
      kronosRuntime: { status: "idle", generatedAt: null, error: null },
      setActiveSymbol: (s) => {
        const sym = normalizeSymbol(s);
        if (sym) set({ activeSymbol: sym });
      },
      setCommandOpen: (open) => set({ commandOpen: open }),
      addWidget: (type, symbol) =>
        set((st) => {
          const id = `w-${type}-${Date.now()}`;
          const size = SIZE_BY_TYPE[type];
          const maxY = st.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
          return {
            widgets: [...st.widgets, { id, type, symbol, linked: !symbol }],
            layout: [...st.layout, { i: id, x: 0, y: maxY, ...size }],
          };
        }),
      removeWidget: (id) =>
        set((st) => ({
          widgets: st.widgets.filter((w) => w.id !== id),
          layout: st.layout.filter((l) => l.i !== id),
        })),
      setWidgetSymbol: (id, symbol) => {
        const sym = normalizeSymbol(symbol);
        if (!sym) return;
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, symbol: sym, linked: false } : w)),
        }));
      },
      toggleLinked: (id) =>
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, linked: !w.linked } : w)),
        })),
      setLayout: (layout) => set({ layout }),
      addToWatchlist: (s) => {
        const sym = normalizeSymbol(s);
        if (!sym) return;
        set((st) => ({
          watchlist: st.watchlist.includes(sym) ? st.watchlist : [...st.watchlist, sym],
        }));
      },
      removeFromWatchlist: (s) => set((st) => ({ watchlist: st.watchlist.filter((x) => x !== s) })),
      resetWorkspace: () => set({ widgets: DEFAULT_WIDGETS, layout: DEFAULT_LAYOUT }),
      setPrimaryChart: (primaryChart) => set({ primaryChart }),
      setKronos: (settings) => set((state) => ({ kronos: { ...state.kronos, ...settings } })),
      setKronosRuntime: (runtime) => set((state) => ({
        kronosRuntime: { ...state.kronosRuntime, ...runtime },
      })),
    }),
    {
      name: "openterminal-workspace",
      partialize: (state) => ({
        activeSymbol: state.activeSymbol,
        widgets: state.widgets,
        layout: state.layout,
        watchlist: state.watchlist,
        primaryChart: state.primaryChart,
        kronos: state.kronos,
      }) as TerminalState,
    }
  )
);

/** Symbol a widget should display: its own, or the active one when linked. */
export function useWidgetSymbol(widget: WidgetInstance): string {
  const active = useTerminal((s) => s.activeSymbol);
  return widget.linked ? active : widget.symbol ?? active;
}
