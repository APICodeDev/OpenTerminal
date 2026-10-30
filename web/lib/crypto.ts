export const COMMON_CRYPTO_USD = [
  "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "DOGEUSD", "ADAUSD", "BNBUSD",
  "SUIUSD", "TRXUSD", "HBARUSD", "AVAXUSD", "LINKUSD", "BCHUSD", "DOTUSD",
  "LTCUSD", "UNIUSD", "XLMUSD", "SHIBUSD", "PEPEUSD", "AAVEUSD", "APTUSD",
  "ARBUSD", "OPUSD", "ATOMUSD", "NEARUSD", "FILUSD", "ETCUSD", "ALGOUSD",
] as const;

export function cryptoUsdSymbol(raw: string): string {
  const value = raw.toUpperCase().replace(/[\/-]/g, "").replace(/USDT$/, "USD");
  const canonical = value.endsWith("USD") ? value : value + "USD";
  return (COMMON_CRYPTO_USD as readonly string[]).includes(canonical) ? canonical : "BTCUSD";
}

export function isCryptoUsdSymbol(raw: string): boolean {
  const value = raw.toUpperCase().replace(/[\/-]/g, "").replace(/USDT$/, "USD");
  const canonical = value.endsWith("USD") ? value : value + "USD";
  return (COMMON_CRYPTO_USD as readonly string[]).includes(canonical);
}

export function krakenWsSymbol(raw: string): string {
  const symbol = cryptoUsdSymbol(raw);
  return `${symbol.slice(0, -3)}/USD`;
}
