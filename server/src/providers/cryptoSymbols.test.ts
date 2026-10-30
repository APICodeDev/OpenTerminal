import { describe, expect, it } from "vitest";
import { canonicalCryptoSymbol, cryptoAsset } from "./cryptoSymbols.js";

describe("canonical crypto USD symbols", () => {
  it.each([
    ["btc", "BTCUSD"],
    ["BTC/USD", "BTCUSD"],
    ["ethusdt", "ETHUSD"],
    ["UNIUSD", "UNIUSD"],
    ["avax-usd", "AVAXUSD"],
    ["renderusd", "RENDERUSD"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(canonicalCryptoSymbol(input)).toBe(expected);
  });

  it("rejects assets outside the supported liquid USD list", () => {
    expect(canonicalCryptoSymbol("NOTACOINUSD")).toBeNull();
  });

  it("maps the user-facing BTC pair to Kraken's XBT identifiers", () => {
    expect(cryptoAsset("BTCUSD")).toMatchObject({
      krakenSpot: "XBTUSD",
      krakenWs: "BTC/USD",
      krakenFuture: "PF_XBTUSD",
    });
  });
});
