/** Chains Degensdesk can scan. Names match DexScreener chain ids. */
export const CHAINS = ["solana", "ethereum", "base", "bsc"] as const;
export type Chain = (typeof CHAINS)[number];

export function isChain(value: string): value is Chain {
  return (CHAINS as readonly string[]).includes(value);
}

export type SourceName = "dexscreener" | "rugcheck" | "goplus";

export type Severity = "info" | "warn" | "danger";

/** A single finding about a token, e.g. "mint authority enabled". */
export interface Flag {
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  source: SourceName;
}

export interface Holder {
  address: string;
  /** Percent of total supply, 0-100. */
  pct: number;
  /** Known dev/creator/insider wallet. */
  insider?: boolean;
  /** Liquidity pool, burn or lock contract rather than a person. */
  isPool?: boolean;
}

export interface MarketData {
  name?: string;
  symbol?: string;
  priceUsd?: number;
  liquidityUsd?: number;
  fdvUsd?: number;
  marketCapUsd?: number;
  volume24hUsd?: number;
  priceChange24hPct?: number;
  /** Unix ms when the oldest known trading pair was created. */
  pairCreatedAt?: number;
  pairUrl?: string;
  dexId?: string;
  imageUrl?: string;
  websites: string[];
  socials: { type: string; url: string }[];
}

/**
 * What a single source tells us about a token, normalised so the
 * analysis layer doesn't need to know any API's shape.
 */
export interface SourceSignals {
  source: SourceName;
  market?: MarketData;
  holders?: Holder[];
  creator?: string;
  /** Percent of supply held by the creator/dev wallet(s), 0-100. */
  devHoldingsPct?: number;
  /** Percent of LP that is locked or burned, 0-100. */
  lpLockedPct?: number;
  mintAuthorityEnabled?: boolean;
  freezeAuthorityEnabled?: boolean;
  metadataMutable?: boolean;
  isHoneypot?: boolean;
  buyTaxPct?: number;
  sellTaxPct?: number;
  /** The source itself has marked this token as rugged. */
  rugged?: boolean;
  /** Findings that come straight from the source and have no normalised field. */
  flags: Flag[];
}

export interface SourceError {
  source: SourceName;
  message: string;
}

/** "unknown" means no security source answered, so the score only reflects market data. */
export type Verdict = "low" | "medium" | "high" | "extreme" | "unknown";

export interface TokenReport {
  chain: Chain;
  address: string;
  scannedAt: string;
  market?: MarketData;
  devHoldingsPct?: number;
  top10HoldersPct?: number;
  lpLockedPct?: number;
  topHolders: Holder[];
  flags: Flag[];
  /** 0 (looks clean) to 100 (almost certainly a rug). */
  riskScore: number;
  verdict: Verdict;
  sources: SourceName[];
  errors: SourceError[];
}
