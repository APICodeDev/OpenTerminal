"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
  BarSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, apiPost, fmt, fmtBig, type Candle } from "../../lib/api";
import { isCryptoUsdSymbol } from "../../lib/crypto";
import { sma, ema, vwap, rsi, macd, bollinger, type Point } from "../../lib/indicators";
import {
  isKronosTimeframe,
  useTerminal,
  useWidgetSymbol,
  type ChartTimeframe,
  type WidgetInstance,
} from "../../store/terminal";

type OrderflowSample = {
  timestamp: number;
  levels: Array<{ price: number; bidNotional: number; askNotional: number }>;
};
type OrderflowEvent = {
  id: string;
  timestamp: number;
  price: number;
  notional: number;
  side: "buy" | "sell";
  type: "trade" | "liquidation";
};
type OrderflowHistory = {
  symbol: string;
  retentionMs: number;
  samples: OrderflowSample[];
  events: OrderflowEvent[];
};
type KronosPrediction = {
  symbol: string;
  timeframe: string;
  model: string;
  lastCandleTime: number;
  generatedAt: string;
  forecast: Candle[];
  cached: boolean;
};

const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
const TIMEFRAMES = ["AUTO", "4H", "3H", "1H", "30m", "15m", "5m", "1m", "10s", "1s"] as const;
const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
const INDICATORS = ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP", "BOLL", "RSI", "MACD"] as const;
const ORDERFLOW_SAMPLE_SECONDS = 1;
const STOCK_UNSUPPORTED_TIMEFRAMES = new Set<Timeframe>(["1m", "10s", "1s"]);
const KRONOS_INTERVAL_SECONDS: Partial<Record<ChartTimeframe, number>> = {
  "5m": 5 * 60,
  "15m": 15 * 60,
  "30m": 30 * 60,
  "1H": 60 * 60,
  "3H": 3 * 60 * 60,
  "4H": 4 * 60 * 60,
};

function percentileCap(values: number[], percentile = 0.95): number {
  const sorted = values.filter((value) => value > 0 && Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return 1;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return Math.max(1, sorted[index]);
}

function heatStrength(value: number, cap: number): number {
  return Math.sqrt(Math.min(1, Math.max(0, value / cap)));
}

function depthHeatColor(side: "buy" | "sell", strength: number): string {
  const clamped = Math.min(1, Math.max(0, strength));
  const alpha = 0.1 + clamped * 0.68;
  if (side === "buy") {
    const green = Math.round(105 + clamped * 130);
    const blue = Math.round(70 + clamped * 70);
    return `rgba(0, ${green}, ${blue}, ${alpha})`;
  }
  const red = Math.round(150 + clamped * 105);
  const green = Math.round(35 + clamped * 35);
  return `rgba(${red}, ${green}, 65, ${alpha})`;
}

type Range = (typeof RANGES)[number];
type Timeframe = (typeof TIMEFRAMES)[number];
type ChartType = (typeof CHART_TYPES)[number];
type Indicator = (typeof INDICATORS)[number];

const ts = (t: number) => t as UTCTimestamp;
const toMap = (pts: Point[]) => new Map(pts.map((p) => [p.time, p.value]));

const INDICATOR_COLOR: Record<string, string> = {
  SMA20: "#ffd966", SMA50: "#4fc3f7", SMA200: "#ba68c8", EMA20: "#ff8a65",
  VWAP: "#80cbc4", RSI: "#ff9900", BOLL: "#ff9900", MACD: "#4fc3f7",
};

export default function ChartWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [range, setRange] = useState<Range>("6M");
  const [timeframe, setTimeframe] = useState<Timeframe>(() => useTerminal.getState().primaryChart.timeframe);
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [active, setActive] = useState<Set<Indicator>>(new Set(["SMA20"]));
  const [showLiquidityMap, setShowLiquidityMap] = useState(false);
  const [showOrderFlow, setShowOrderFlow] = useState(false);
  const [showLiquidations, setShowLiquidations] = useState(false);
  const [legend, setLegend] = useState<Candle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);
  const priceToCoordinateRef = useRef<((price: number) => number | null) | null>(null);
  const isCrypto = isCryptoUsdSymbol(symbol);
  const effectiveTimeframe: Timeframe = !isCrypto && STOCK_UNSUPPORTED_TIMEFRAMES.has(timeframe) ? "AUTO" : timeframe;
  const isPrimaryChart = useTerminal((state) => state.widgets.find((item) => item.type === "chart")?.id === widget.id);
  const kronos = useTerminal((state) => state.kronos);
  const setPrimaryChart = useTerminal((state) => state.setPrimaryChart);
  const setKronosRuntime = useTerminal((state) => state.setKronosRuntime);
  const kronosEligible = isPrimaryChart && isKronosTimeframe(effectiveTimeframe);
  const orderflowEnabled = isCrypto && (showLiquidityMap || showOrderFlow || showLiquidations);
  const { data: orderflow, error: orderflowError } = useQuery({
    queryKey: ["chart-orderflow-history", symbol],
    queryFn: () => apiGet<OrderflowHistory>(`/api/crypto/orderflow/${encodeURIComponent(symbol)}`),
    refetchInterval: 2_000,
    enabled: orderflowEnabled,
  });

  const selectTimeframe = (next: Timeframe) => {
    setTimeframe(next);
    if (next === "1s" || next === "10s" || next === "1m") setRange("1D");
    else if (next === "5m") setRange(isCrypto ? "1D" : "5D");
    else if (next === "15m" || next === "30m" || next === "1H") setRange("5D");
    else if (next === "3H" || next === "4H") setRange("1M");
  };

  const refetchMs = effectiveTimeframe === "1s"
    ? 1_000
    : effectiveTimeframe === "10s"
    ? 2_000
    : effectiveTimeframe !== "AUTO"
    ? 5_000
    : range === "1D"
    ? 8_000
    : 60_000;

  const { data: candles, error } = useQuery({
    queryKey: ["history", symbol, range, effectiveTimeframe, orderflowEnabled ? "binance-futures" : "default"],
    queryFn: () => apiGet<Candle[]>(
      `/api/history/${encodeURIComponent(symbol)}?range=${range}&interval=${encodeURIComponent(effectiveTimeframe)}${orderflowEnabled ? "&venue=binance-futures" : ""}`
    ),
    refetchInterval: refetchMs,
  });

  useEffect(() => {
    if (timeframe !== effectiveTimeframe) setTimeframe(effectiveTimeframe);
  }, [effectiveTimeframe, timeframe]);

  useEffect(() => {
    if (isPrimaryChart) setPrimaryChart({ symbol, timeframe: effectiveTimeframe });
  }, [effectiveTimeframe, isPrimaryChart, setPrimaryChart, symbol]);

  const kronosClosedCandles = useMemo(() => {
    const intervalSeconds = KRONOS_INTERVAL_SECONDS[effectiveTimeframe];
    if (!candles || !intervalSeconds) return [];
    const now = Math.floor(Date.now() / 1000);
    return candles
      .filter((candle) => candle.time + intervalSeconds <= now)
      .sort((a, b) => a.time - b.time)
      .slice(-kronos.lookback);
  }, [candles, effectiveTimeframe, kronos.lookback]);
  const lastClosedCandleTime = kronosClosedCandles.at(-1)?.time ?? null;

  const {
    data: kronosPrediction,
    error: kronosError,
    isFetching: kronosLoading,
  } = useQuery({
    queryKey: [
      "kronos-prediction",
      symbol,
      effectiveTimeframe,
      lastClosedCandleTime,
      kronos.model,
      kronos.lookback,
      kronos.predictionLength,
      kronos.temperature,
      kronos.topK,
      kronos.topP,
      kronos.sampleCount,
    ],
    queryFn: () => apiPost<KronosPrediction>("/api/kronos/predict", {
      symbol,
      timeframe: effectiveTimeframe,
      model: kronos.model,
      lookback: kronos.lookback,
      predictionLength: kronos.predictionLength,
      temperature: kronos.temperature,
      topK: kronos.topK,
      topP: kronos.topP,
      sampleCount: kronos.sampleCount,
      candles: kronosClosedCandles,
    }),
    enabled: kronos.enabled && kronosEligible && kronosClosedCandles.length >= 32 && lastClosedCandleTime !== null,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!isPrimaryChart) return;
    if (!kronos.enabled) {
      setKronosRuntime({ status: "idle", error: null });
    } else if (!kronosEligible) {
      setKronosRuntime({ status: "paused", error: null });
    } else if (kronosLoading) {
      setKronosRuntime({ status: "loading", error: null });
    } else if (kronosError) {
      setKronosRuntime({ status: "error", error: kronosError.message });
    } else if (kronosPrediction) {
      setKronosRuntime({ status: "ready", generatedAt: kronosPrediction.generatedAt, error: null });
    } else {
      setKronosRuntime({ status: "idle", error: null });
    }
  }, [isPrimaryChart, kronos.enabled, kronosEligible, kronosError, kronosLoading, kronosPrediction, setKronosRuntime]);

  // Fast time -> candle lookup for the crosshair legend, independent of chart type.
  const byTime = useMemo(() => {
    const m = new Map<number, Candle>();
    for (const c of candles ?? []) m.set(c.time, c);
    return m;
  }, [candles]);

  // Computed once per candles/active change, shared by both the chart overlays
  // below and the hover legend — avoids recomputing the same series twice.
  const indicatorData = useMemo(() => {
    if (!candles || candles.length === 0) return null;
    return {
      SMA20: active.has("SMA20") ? sma(candles, 20) : null,
      SMA50: active.has("SMA50") ? sma(candles, 50) : null,
      SMA200: active.has("SMA200") ? sma(candles, 200) : null,
      EMA20: active.has("EMA20") ? ema(candles, 20) : null,
      VWAP: active.has("VWAP") ? vwap(candles) : null,
      RSI: active.has("RSI") ? rsi(candles) : null,
      BOLL: active.has("BOLL") ? bollinger(candles) : null,
      MACD: active.has("MACD") ? macd(candles) : null,
    };
  }, [candles, active]);

  const indicatorMaps = useMemo(() => {
    const maps: Record<string, Map<number, number>> = {};
    if (!indicatorData) return maps;
    if (indicatorData.SMA20) maps.SMA20 = toMap(indicatorData.SMA20);
    if (indicatorData.SMA50) maps.SMA50 = toMap(indicatorData.SMA50);
    if (indicatorData.SMA200) maps.SMA200 = toMap(indicatorData.SMA200);
    if (indicatorData.EMA20) maps.EMA20 = toMap(indicatorData.EMA20);
    if (indicatorData.VWAP) maps.VWAP = toMap(indicatorData.VWAP);
    if (indicatorData.RSI) maps.RSI = toMap(indicatorData.RSI);
    if (indicatorData.BOLL) {
      maps.BOLL_U = toMap(indicatorData.BOLL.upper);
      maps.BOLL_M = toMap(indicatorData.BOLL.middle);
      maps.BOLL_L = toMap(indicatorData.BOLL.lower);
    }
    if (indicatorData.MACD) {
      maps.MACD_M = toMap(indicatorData.MACD.macd);
      maps.MACD_S = toMap(indicatorData.MACD.signal);
      maps.MACD_H = toMap(indicatorData.MACD.histogram);
    }
    return maps;
  }, [indicatorData]);

  const indicatorRows = useMemo(() => {
    if (!legend) return [];
    const t = legend.time;
    const get = (key: string) => indicatorMaps[key]?.get(t);
    const rows: Array<{ label: string; value: string; color: string }> = [];
    for (const key of ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP"] as const) {
      const v = get(key);
      if (v !== undefined) rows.push({ label: key, value: fmt(v), color: INDICATOR_COLOR[key] });
    }
    const rsiV = get("RSI");
    if (rsiV !== undefined) rows.push({ label: "RSI", value: fmt(rsiV, 1), color: INDICATOR_COLOR.RSI });
    const bollM = get("BOLL_M");
    if (bollM !== undefined) {
      rows.push({
        label: "BOLL",
        value: `${fmt(get("BOLL_U"))} / ${fmt(bollM)} / ${fmt(get("BOLL_L"))}`,
        color: INDICATOR_COLOR.BOLL,
      });
    }
    const macdM = get("MACD_M");
    if (macdM !== undefined) {
      rows.push({
        label: "MACD",
        value: `${fmt(macdM, 2)} / ${fmt(get("MACD_S"), 2)} / ${fmt(get("MACD_H"), 2)}`,
        color: INDICATOR_COLOR.MACD,
      });
    }
    return rows;
  }, [legend, indicatorMaps]);

  useEffect(() => {
    setLegend(candles && candles.length > 0 ? candles[candles.length - 1] : null);
  }, [candles]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !candles || candles.length === 0) return;

    const chart = createChart(el, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#808080", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
      crosshair: { mode: 0 },
      timeScale: {
        borderColor: "#262626",
        timeVisible: effectiveTimeframe !== "AUTO" || range === "1D" || range === "5D",
        secondsVisible: effectiveTimeframe === "1s" || effectiveTimeframe === "10s",
      },
      rightPriceScale: { borderColor: "#262626" },
      autoSize: true,
      // Mouse-wheel is left free for page scrolling — zoom via drag, pinch, or the range buttons instead.
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    const upColor = "#00c853";
    const downColor = "#ff3d3d";

    if (chartType === "candles") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor, downColor, borderUpColor: upColor, borderDownColor: downColor,
        wickUpColor: upColor, wickDownColor: downColor,
      });
      series.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
      priceToCoordinateRef.current = (price) => series.priceToCoordinate(price);
    } else if (chartType === "bars") {
      const series = chart.addSeries(BarSeries, { upColor, downColor });
      series.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
      priceToCoordinateRef.current = (price) => series.priceToCoordinate(price);
    } else if (chartType === "line") {
      const series = chart.addSeries(LineSeries, { color: "#ff9900", lineWidth: 1 });
      series.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
      priceToCoordinateRef.current = (price) => series.priceToCoordinate(price);
    } else {
      const series = chart.addSeries(AreaSeries, { lineColor: "#ff9900", topColor: "rgba(255,153,0,0.25)", bottomColor: "rgba(255,153,0,0)" });
      series.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
      priceToCoordinateRef.current = (price) => series.priceToCoordinate(price);
    }

    // volume histogram on its own scale at the bottom of the main pane
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    vol.setData(
      candles.map((c) => ({ time: ts(c.time), value: c.volume, color: c.close >= c.open ? "rgba(0,200,83,0.4)" : "rgba(255,61,61,0.4)" }))
    );

    const overlay = (points: Point[], color: string) =>
      chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(points.map((p) => ({ time: ts(p.time), value: p.value })));

    if (indicatorData?.SMA20) overlay(indicatorData.SMA20, INDICATOR_COLOR.SMA20);
    if (indicatorData?.SMA50) overlay(indicatorData.SMA50, INDICATOR_COLOR.SMA50);
    if (indicatorData?.SMA200) overlay(indicatorData.SMA200, INDICATOR_COLOR.SMA200);
    if (indicatorData?.EMA20) overlay(indicatorData.EMA20, INDICATOR_COLOR.EMA20);
    if (indicatorData?.VWAP) overlay(indicatorData.VWAP, INDICATOR_COLOR.VWAP);
    if (indicatorData?.BOLL) {
      overlay(indicatorData.BOLL.upper, "rgba(255,153,0,0.5)");
      overlay(indicatorData.BOLL.middle, "rgba(255,153,0,0.8)");
      overlay(indicatorData.BOLL.lower, "rgba(255,153,0,0.5)");
    }

    if (kronos.enabled && kronosEligible && kronosPrediction?.forecast.length) {
      const forecast = kronosPrediction.forecast;
      const forecastCandles = chart.addSeries(CandlestickSeries, {
        upColor: "rgba(0, 188, 212, 0.58)",
        downColor: "rgba(224, 64, 251, 0.58)",
        borderUpColor: "#00bcd4",
        borderDownColor: "#e040fb",
        wickUpColor: "#00bcd4",
        wickDownColor: "#e040fb",
        priceLineVisible: false,
        lastValueVisible: true,
        title: "KRONOS",
      });
      forecastCandles.setData(forecast.map((candle) => ({
        time: ts(candle.time),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })));
      const lastActual = candles.find((candle) => candle.time === kronosPrediction.lastCandleTime)
        ?? candles[candles.length - 1];
      chart.addSeries(LineSeries, {
        color: "#ffd54f",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "Kronos close",
      }).setData([
        { time: ts(lastActual.time), value: lastActual.close },
        ...forecast.map((candle) => ({ time: ts(candle.time), value: candle.close })),
      ]);
    }

    let paneIdx = 1;
    if (indicatorData?.RSI) {
      const s = chart.addSeries(LineSeries, { color: INDICATOR_COLOR.RSI, lineWidth: 1 }, paneIdx++);
      s.setData(indicatorData.RSI.map((p) => ({ time: ts(p.time), value: p.value })));
    }
    if (indicatorData?.MACD) {
      const m = indicatorData.MACD;
      const pane = paneIdx++;
      chart.addSeries(HistogramSeries, { color: "#4fc3f7" }, pane).setData(
        m.histogram.map((p) => ({ time: ts(p.time), value: p.value, color: p.value >= 0 ? "rgba(0,200,83,0.6)" : "rgba(255,61,61,0.6)" }))
      );
      chart.addSeries(LineSeries, { color: "#ff9900", lineWidth: 1 }, pane).setData(
        m.macd.map((p) => ({ time: ts(p.time), value: p.value }))
      );
      chart.addSeries(LineSeries, { color: "#ffffff", lineWidth: 1 }, pane).setData(
        m.signal.map((p) => ({ time: ts(p.time), value: p.value }))
      );
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setLegend(candles[candles.length - 1]);
        return;
      }
      const hit = byTime.get(param.time as number);
      if (hit) setLegend(hit);
    });

    if (orderflowEnabled && candles.length > 0) {
      const lastTime = candles[candles.length - 1].time;
      const forecastEnd = kronos.enabled && kronosEligible ? kronosPrediction?.forecast.at(-1)?.time : null;
      chart.timeScale().setVisibleRange({
        from: ts(lastTime - 30 * 60),
        to: ts(forecastEnd ?? lastTime + 60),
      });
    } else {
      chart.timeScale().fitContent();
    }
    return () => {
      chart.remove();
      chartRef.current = null;
      priceToCoordinateRef.current = null;
    };
  }, [candles, chartType, indicatorData, range, effectiveTimeframe, byTime, orderflowEnabled, kronos.enabled, kronosEligible, kronosPrediction]);

  useEffect(() => {
    const canvas = heatmapCanvasRef.current;
    const container = containerRef.current?.parentElement;
    const chart = chartRef.current;
    const priceToCoordinate = priceToCoordinateRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !container || !chart || !priceToCoordinate || !context || !orderflowEnabled || !orderflow) return;
    const candleData = candles;
    if (!candleData || candleData.length === 0) return;

    let frame = 0;
    const draw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = container.getBoundingClientRect();
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.round(bounds.width * pixelRatio);
        canvas.height = Math.round(bounds.height * pixelRatio);
        canvas.style.width = `${bounds.width}px`;
        canvas.style.height = `${bounds.height}px`;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, bounds.width, bounds.height);
        context.save();
        context.beginPath();
        context.rect(0, 0, bounds.width, bounds.height);
        context.clip();

        const candleTimes = candleData.map((candle) => candle.time);
        const candleCoordinates = new Map<number, number>();
        const coordinateForIndex = (index: number): number | null => {
          if (index < 0 || index >= candleTimes.length) return null;
          const cached = candleCoordinates.get(index);
          if (cached !== undefined) return cached;
          const coordinate = chart.timeScale().timeToCoordinate(ts(candleTimes[index]));
          if (coordinate !== null) candleCoordinates.set(index, coordinate);
          return coordinate;
        };
        const toX = (timestamp: number): number | null => {
          const seconds = timestamp / 1000;
          let low = 0;
          let high = candleTimes.length;
          while (low < high) {
            const middle = (low + high) >>> 1;
            if (candleTimes[middle] < seconds) low = middle + 1;
            else high = middle;
          }
          if (low < candleTimes.length && candleTimes[low] === seconds) return coordinateForIndex(low);
          const left = low - 1;
          const right = low;
          const leftX = coordinateForIndex(left);
          const rightX = coordinateForIndex(right);
          if (leftX !== null && rightX !== null) {
            const ratio = (seconds - candleTimes[left]) / (candleTimes[right] - candleTimes[left]);
            return leftX + (rightX - leftX) * ratio;
          }
          // The current depth sample normally falls inside the still-open last
          // candle, so extrapolate from the preceding candle spacing.
          if (leftX !== null && left > 0) {
            const previousX = coordinateForIndex(left - 1);
            const duration = candleTimes[left] - candleTimes[left - 1];
            if (previousX !== null && duration > 0) {
              return leftX + (leftX - previousX) * ((seconds - candleTimes[left]) / duration);
            }
          }
          if (rightX !== null && right + 1 < candleTimes.length) {
            const nextX = coordinateForIndex(right + 1);
            const duration = candleTimes[right + 1] - candleTimes[right];
            if (nextX !== null && duration > 0) {
              return rightX - (nextX - rightX) * ((candleTimes[right] - seconds) / duration);
            }
          }
          return null;
        };
        const toY = (price: number) => priceToCoordinate(price);
        const samples = orderflow.samples;
        // Like ATAS' upper cut-off, saturate the top 5% so one exceptional
        // wall does not make every other resting level disappear.
        const depthCap = percentileCap(samples.flatMap((sample) =>
          sample.levels.map((level) => Math.max(level.bidNotional, level.askNotional))
        ));

        if (showLiquidityMap) {
          for (let index = 0; index < samples.length; index += 1) {
            const sample = samples[index];
            const x = toX(sample.timestamp);
            if (x === null) continue;
            const nextX = toX(sample.timestamp + ORDERFLOW_SAMPLE_SECONDS * 1000);
            const width = Math.max(0.75, (nextX ?? x + 1) - x);
            const prices = sample.levels.map((level) => level.price).sort((a, b) => a - b);
            let tickSize = 0;
            for (let priceIndex = 1; priceIndex < prices.length; priceIndex += 1) {
              const difference = prices[priceIndex] - prices[priceIndex - 1];
              if (difference > 0 && (!tickSize || difference < tickSize)) tickSize = difference;
            }
            if (!tickSize && prices.length > 0) tickSize = prices[0] * 0.0001;

            for (const level of sample.levels) {
              const notional = Math.max(level.bidNotional, level.askNotional);
              if (notional <= 0) continue;
              const y = toY(level.price);
              const upperY = toY(level.price + tickSize / 2);
              const lowerY = toY(level.price - tickSize / 2);
              if (y === null) continue;
              const cellHeight = Math.max(1, Math.min(24, Math.abs((upperY ?? y - 1) - (lowerY ?? y + 1))));
              const side = level.bidNotional > 0 ? "buy" : "sell";
              const intensity = heatStrength(notional, depthCap);
              context.fillStyle = depthHeatColor(side, intensity);
              context.fillRect(x, y - cellHeight / 2, width, cellHeight);
            }
          }
        }

        const drawEvents = (events: OrderflowEvent[], liquidation: boolean) => {
          const eligible = events
            .filter((event) => liquidation ? event.type === "liquidation" : event.type === "trade")
            .sort((a, b) => b.notional - a.notional)
            .slice(0, liquidation ? 250 : 400)
            .sort((a, b) => a.timestamp - b.timestamp);
          const notionalCap = percentileCap(eligible.map((event) => event.notional));
          for (const event of eligible) {
            const x = toX(event.timestamp);
            const y = toY(event.price);
            if (x === null || y === null) continue;
            const intensity = heatStrength(event.notional, notionalCap);
            const radius = liquidation ? 4 + 9 * intensity : 2.5 + 9 * intensity;
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            if (liquidation) {
              context.fillStyle = depthHeatColor(event.side, intensity);
              context.strokeStyle = `rgba(255, 190, 0, ${0.45 + intensity * 0.5})`;
              context.lineWidth = 1 + intensity * 1.5;
              context.fill();
              context.stroke();
            } else {
              context.fillStyle = depthHeatColor(event.side, intensity);
              context.globalAlpha = 0.25 + 0.75 * intensity;
              context.fill();
              context.globalAlpha = 1;
            }
          }
        };
        if (showOrderFlow) drawEvents(orderflow.events, false);
        if (showLiquidations) drawEvents(orderflow.events, true);
        context.restore();
      });
    };

    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleTimeRangeChange(draw);
    container.addEventListener("pointermove", draw);
    container.addEventListener("pointerup", draw);
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(container);
    draw();
    return () => {
      cancelAnimationFrame(frame);
      timeScale.unsubscribeVisibleTimeRangeChange(draw);
      container.removeEventListener("pointermove", draw);
      container.removeEventListener("pointerup", draw);
      resizeObserver.disconnect();
    };
  }, [orderflow, orderflowEnabled, showLiquidityMap, showOrderFlow, showLiquidations, candles, chartType]);

  const toggleIndicator = (ind: Indicator) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(ind)) next.delete(ind);
      else next.add(ind);
      return next;
    });

  const prepareOrderflowView = (enabled: boolean) => {
    if (enabled && (timeframe === "AUTO" || timeframe === "1s" || timeframe === "10s")) {
      setRange("1D");
      setTimeframe("1m");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0">
        <span className="dim px-1 self-center">RANGO</span>
        {RANGES.map((r) => (
          <button key={r} className={`term-btn ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>
            {r}
          </button>
        ))}
        <>
          <span className="w-2" />
          <span className="dim px-1 self-center">VELA</span>
          {TIMEFRAMES.map((value) => {
            const unavailableForFutures = orderflowEnabled && (value === "1s" || value === "10s");
            const unavailableForStocks = !isCrypto && (value === "1s" || value === "10s" || value === "1m");
            const unavailable = unavailableForFutures || unavailableForStocks;
            return (
              <button
                key={value}
                className={`term-btn ${timeframe === value ? "active" : ""}`}
                disabled={unavailable}
                title={
                  unavailableForFutures
                    ? "Binance USD-M no ofrece velas por debajo de 1 minuto"
                    : unavailableForStocks
                    ? "El proveedor de acciones admite velas explícitas desde 5 minutos"
                    : undefined
                }
                onClick={() => selectTimeframe(value)}
              >
                {value}
              </button>
            );
          })}
        </>
        <span className="w-2" />
        {CHART_TYPES.map((t) => (
          <button key={t} className={`term-btn ${chartType === t ? "active" : ""}`} onClick={() => setChartType(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        <span className="w-2" />
        {INDICATORS.map((ind) => (
          <button key={ind} className={`term-btn ${active.has(ind) ? "active" : ""}`} onClick={() => toggleIndicator(ind)}>
            {ind}
          </button>
        ))}
        {isCrypto && <>
          <span className="w-2" />
          <label className="flex items-center gap-1 px-1 text-[10px] dim">
            <input
              type="checkbox"
              checked={showLiquidityMap}
              onChange={(event) => {
                prepareOrderflowView(event.target.checked);
                setShowLiquidityMap(event.target.checked);
              }}
            />
            MAPA LIQUIDEZ
          </label>
          <label className="flex items-center gap-1 px-1 text-[10px] dim">
            <input
              type="checkbox"
              checked={showOrderFlow}
              onChange={(event) => {
                prepareOrderflowView(event.target.checked);
                setShowOrderFlow(event.target.checked);
              }}
            />
            ORDER FLOW
          </label>
          <label className="flex items-center gap-1 px-1 text-[10px] dim">
            <input
              type="checkbox"
              checked={showLiquidations}
              onChange={(event) => {
                prepareOrderflowView(event.target.checked);
                setShowLiquidations(event.target.checked);
              }}
            />
            LIQUIDACIONES
          </label>
        </>}
      </div>
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      {orderflowError && orderflowEnabled && <div className="px-2 py-1 text-[10px] text-[var(--amber)]">{orderflowError.message}</div>}
      {kronosError && kronos.enabled && kronosEligible && <div className="px-2 py-1 text-[10px] down">Kronos: {kronosError.message}</div>}
      <div className="relative flex-1 min-h-0">
        {legend && (
          <div className="absolute top-1 left-2 z-10 flex flex-col gap-0.5 text-[11px] pointer-events-none bg-[rgba(10,10,10,0.7)] px-2 py-1 rounded max-w-[95%]">
            <div className="flex gap-3">
              <span className="dim">O <span className="text-[var(--text)]">{fmt(legend.open)}</span></span>
              <span className="dim">H <span className="up">{fmt(legend.high)}</span></span>
              <span className="dim">L <span className="down">{fmt(legend.low)}</span></span>
              <span className="dim">C <span className={legend.close >= legend.open ? "up" : "down"}>{fmt(legend.close)}</span></span>
              <span className="dim">Vol <span className="text-[var(--text)]">{fmtBig(legend.volume)}</span></span>
            </div>
            {indicatorRows.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {indicatorRows.map((r) => (
                  <span key={r.label} className="dim">
                    {r.label} <span style={{ color: r.color }}>{r.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {orderflowEnabled && (
          <div className="absolute left-2 top-14 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 bg-[rgba(10,10,10,0.78)] px-2 py-1 text-[9px] dim pointer-events-none">
            <span>BINANCE USD-M · PRECIO/TIEMPO · ÚLTIMOS 30 MIN</span>
            {showLiquidityMap && <>
              <span className="flex items-center gap-1"><i className="h-2 w-3 bg-emerald-500" /> BID · COMPRA</span>
              <span className="flex items-center gap-1"><i className="h-2 w-3 bg-red-500" /> ASK · VENTA</span>
              <span>MÁS INTENSIDAD = MÁS LIQUIDEZ</span>
            </>}
            {showLiquidations && <span>ARO DORADO = LIQUIDACIÓN</span>}
          </div>
        )}
        {kronos.enabled && kronosEligible && (
          <div className={`absolute right-16 top-1 z-10 border px-2 py-1 text-[9px] pointer-events-none ${
            kronosError
              ? "border-[var(--down)]/60 bg-[rgba(40,0,0,0.82)] down"
              : "border-[#ffd54f]/50 bg-[rgba(10,10,10,0.82)] text-[#ffd54f]"
          }`}>
            {kronosLoading
              ? "KRONOS · CALCULANDO…"
              : kronosPrediction
              ? `KRONOS ${kronosPrediction.model.toUpperCase()} · ${kronosPrediction.forecast.length} VELAS · LÍNEA AMARILLA / VELAS CIAN-MAGENTA`
              : "KRONOS · ESPERANDO VELA CERRADA"}
          </div>
        )}
        <div ref={containerRef} className="absolute inset-0 w-full h-full" />
        {orderflowEnabled && <canvas ref={heatmapCanvasRef} className="absolute inset-0 z-[1] pointer-events-none" />}
      </div>
    </div>
  );
}
