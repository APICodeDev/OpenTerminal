"use client";

import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiGet, apiPost, type Quote } from "../../lib/api";
import { isCryptoUsdSymbol } from "../../lib/crypto";
import { useTerminal } from "../../store/terminal";

type Msg = { role: "user" | "assistant"; content: string };

async function optionalGet<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch {
    return null;
  }
}

function tail<T>(value: T[] | null, limit: number): T[] | null {
  return value ? value.slice(-limit) : null;
}

export default function AiWidget() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useMutation({
    mutationFn: async (next: Msg[]) => {
      const symbol = encodeURIComponent(activeSymbol);
      const crypto = isCryptoUsdSymbol(activeSymbol);
      const [quotes, candles, orderBook, trades, liquidations] = await Promise.all([
        optionalGet<Quote[]>(`/api/quotes?symbols=${symbol}`),
        optionalGet<unknown[]>(`/api/history/${symbol}?range=1D&interval=${crypto ? "5m" : "AUTO"}`),
        crypto ? optionalGet<{ bids?: unknown[]; asks?: unknown[] }>(`/api/crypto/orderbook/${symbol}`) : null,
        crypto ? optionalGet<unknown[]>(`/api/crypto/trades/${symbol}`) : null,
        crypto ? optionalGet<{ events?: unknown[]; heatmap?: unknown[] }>(`/api/crypto/liquidations/${symbol}`) : null,
      ]);
      const context = {
        activeSymbol,
        collectedAt: new Date().toISOString(),
        quote: quotes?.[0] ?? null,
        candles: tail(candles, 60),
        orderBook: orderBook ? {
          ...orderBook,
          bids: orderBook.bids?.slice(0, 15),
          asks: orderBook.asks?.slice(0, 15),
        } : null,
        recentTrades: tail(trades, 40),
        liquidations: liquidations ? {
          events: tail(liquidations.events ?? null, 40),
          heatmap: tail(liquidations.heatmap ?? null, 40),
        } : null,
      };
      const res = await apiPost<{ text: string }>("/api/ai/chat", { messages: next, context });
      return { next, reply: res.text };
    },
    onSuccess: ({ next, reply }) => {
      setMessages([...next, { role: "assistant", content: reply }]);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9 }), 50);
    },
  });

  const send = () => {
    const text = input.trim();
    if (!text || chat.isPending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    chat.mutate(next);
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="dim">
            Ask about {activeSymbol}, the market, an indicator, or a headline. Quotes, recent candles and crypto order flow are shared as context.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <span className={m.role === "user" ? "amber" : "up"}>{m.role === "user" ? "YOU" : "AI"} ›</span>{" "}
            <span className="whitespace-pre-wrap">{m.content}</span>
          </div>
        ))}
        {chat.isPending && <div className="dim">thinking…</div>}
        {chat.error && <div className="down">{(chat.error as Error).message}</div>}
      </div>
      <div className="flex gap-1 p-1 border-t border-[var(--border)] shrink-0">
        <input
          className="flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Ask about ${activeSymbol}…`}
        />
        <button className="term-btn" onClick={send}>SEND</button>
      </div>
    </div>
  );
}
