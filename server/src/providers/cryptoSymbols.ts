export type CryptoAsset = {
  base: string;
  symbol: string;
  name: string;
  krakenSpot: string;
  krakenWs: string;
  krakenFuture: string | null;
};

/**
 * Liquid USD markets shared by the crypto board, charts and flow widgets.
 * BTC is XBT in Kraken's REST/Futures APIs, but remains BTC for users.
 */
export const CRYPTO_ASSETS: CryptoAsset[] = [
  { base: "BTC", symbol: "BTCUSD", name: "Bitcoin", krakenSpot: "XBTUSD", krakenWs: "BTC/USD", krakenFuture: "PF_XBTUSD" },
  { base: "ETH", symbol: "ETHUSD", name: "Ethereum", krakenSpot: "ETHUSD", krakenWs: "ETH/USD", krakenFuture: "PF_ETHUSD" },
  { base: "SOL", symbol: "SOLUSD", name: "Solana", krakenSpot: "SOLUSD", krakenWs: "SOL/USD", krakenFuture: "PF_SOLUSD" },
  { base: "XRP", symbol: "XRPUSD", name: "XRP", krakenSpot: "XRPUSD", krakenWs: "XRP/USD", krakenFuture: "PF_XRPUSD" },
  { base: "DOGE", symbol: "DOGEUSD", name: "Dogecoin", krakenSpot: "DOGEUSD", krakenWs: "DOGE/USD", krakenFuture: "PF_DOGEUSD" },
  { base: "ADA", symbol: "ADAUSD", name: "Cardano", krakenSpot: "ADAUSD", krakenWs: "ADA/USD", krakenFuture: "PF_ADAUSD" },
  { base: "BNB", symbol: "BNBUSD", name: "BNB", krakenSpot: "BNBUSD", krakenWs: "BNB/USD", krakenFuture: "PF_BNBUSD" },
  { base: "SUI", symbol: "SUIUSD", name: "Sui", krakenSpot: "SUIUSD", krakenWs: "SUI/USD", krakenFuture: "PF_SUIUSD" },
  { base: "TRX", symbol: "TRXUSD", name: "TRON", krakenSpot: "TRXUSD", krakenWs: "TRX/USD", krakenFuture: "PF_TRXUSD" },
  { base: "HBAR", symbol: "HBARUSD", name: "Hedera", krakenSpot: "HBARUSD", krakenWs: "HBAR/USD", krakenFuture: "PF_HBARUSD" },
  { base: "RENDER", symbol: "RENDERUSD", name: "Render", krakenSpot: "RENDERUSD", krakenWs: "RENDER/USD", krakenFuture: "PF_RENDERUSD" },
  { base: "AVAX", symbol: "AVAXUSD", name: "Avalanche", krakenSpot: "AVAXUSD", krakenWs: "AVAX/USD", krakenFuture: "PF_AVAXUSD" },
  { base: "LINK", symbol: "LINKUSD", name: "Chainlink", krakenSpot: "LINKUSD", krakenWs: "LINK/USD", krakenFuture: "PF_LINKUSD" },
  { base: "BCH", symbol: "BCHUSD", name: "Bitcoin Cash", krakenSpot: "BCHUSD", krakenWs: "BCH/USD", krakenFuture: "PF_BCHUSD" },
  { base: "DOT", symbol: "DOTUSD", name: "Polkadot", krakenSpot: "DOTUSD", krakenWs: "DOT/USD", krakenFuture: "PF_DOTUSD" },
  { base: "LTC", symbol: "LTCUSD", name: "Litecoin", krakenSpot: "LTCUSD", krakenWs: "LTC/USD", krakenFuture: "PF_LTCUSD" },
  { base: "UNI", symbol: "UNIUSD", name: "Uniswap", krakenSpot: "UNIUSD", krakenWs: "UNI/USD", krakenFuture: "PF_UNIUSD" },
  { base: "XLM", symbol: "XLMUSD", name: "Stellar", krakenSpot: "XLMUSD", krakenWs: "XLM/USD", krakenFuture: "PF_XLMUSD" },
  { base: "SHIB", symbol: "SHIBUSD", name: "Shiba Inu", krakenSpot: "SHIBUSD", krakenWs: "SHIB/USD", krakenFuture: "PF_SHIBUSD" },
  { base: "PEPE", symbol: "PEPEUSD", name: "Pepe", krakenSpot: "PEPEUSD", krakenWs: "PEPE/USD", krakenFuture: "PF_PEPEUSD" },
  { base: "AAVE", symbol: "AAVEUSD", name: "Aave", krakenSpot: "AAVEUSD", krakenWs: "AAVE/USD", krakenFuture: "PF_AAVEUSD" },
  { base: "APT", symbol: "APTUSD", name: "Aptos", krakenSpot: "APTUSD", krakenWs: "APT/USD", krakenFuture: "PF_APTUSD" },
  { base: "ARB", symbol: "ARBUSD", name: "Arbitrum", krakenSpot: "ARBUSD", krakenWs: "ARB/USD", krakenFuture: "PF_ARBUSD" },
  { base: "OP", symbol: "OPUSD", name: "Optimism", krakenSpot: "OPUSD", krakenWs: "OP/USD", krakenFuture: "PF_OPUSD" },
  { base: "ATOM", symbol: "ATOMUSD", name: "Cosmos", krakenSpot: "ATOMUSD", krakenWs: "ATOM/USD", krakenFuture: "PF_ATOMUSD" },
  { base: "NEAR", symbol: "NEARUSD", name: "NEAR Protocol", krakenSpot: "NEARUSD", krakenWs: "NEAR/USD", krakenFuture: "PF_NEARUSD" },
  { base: "FIL", symbol: "FILUSD", name: "Filecoin", krakenSpot: "FILUSD", krakenWs: "FIL/USD", krakenFuture: "PF_FILUSD" },
  { base: "ETC", symbol: "ETCUSD", name: "Ethereum Classic", krakenSpot: "ETCUSD", krakenWs: "ETC/USD", krakenFuture: "PF_ETCUSD" },
  { base: "ALGO", symbol: "ALGOUSD", name: "Algorand", krakenSpot: "ALGOUSD", krakenWs: "ALGO/USD", krakenFuture: "PF_ALGOUSD" },
];

const BY_SYMBOL = new Map(CRYPTO_ASSETS.map((asset) => [asset.symbol, asset]));
const BY_BASE = new Map(CRYPTO_ASSETS.map((asset) => [asset.base, asset]));

/** Accept BTC, BTCUSD and the old BTCUSDT spelling, but always return BTCUSD. */
export function canonicalCryptoSymbol(raw: string): string | null {
  const value = raw.trim().toUpperCase().replace(/[\/-]/g, "");
  if (BY_SYMBOL.has(value)) return value;
  if (value.endsWith("USDT")) return BY_BASE.get(value.slice(0, -4))?.symbol ?? null;
  return BY_BASE.get(value)?.symbol ?? null;
}

export function cryptoAsset(raw: string): CryptoAsset | null {
  const symbol = canonicalCryptoSymbol(raw);
  return symbol ? BY_SYMBOL.get(symbol) ?? null : null;
}

export const CRYPTO_SYMBOLS = new Set(CRYPTO_ASSETS.map((asset) => asset.symbol));
