import { analyze } from "./analysis/analyze.js";
import { TtlCache } from "./http.js";
import { fetchDexScreener } from "./sources/dexscreener.js";
import { fetchGoPlus } from "./sources/goplus.js";
import { fetchRugCheck } from "./sources/rugcheck.js";
import type { Chain, SourceError, SourceName, SourceSignals, TokenReport } from "./types.js";

const cache = new TtlCache<SourceSignals>(Number(process.env.CACHE_TTL_SECONDS ?? 60) * 1000);

type Fetcher = (chain: Chain, address: string) => Promise<SourceSignals>;

const FETCHERS: Record<SourceName, Fetcher> = {
  dexscreener: fetchDexScreener,
  rugcheck: (_chain, address) => fetchRugCheck(address),
  goplus: fetchGoPlus,
};

export function sourcesFor(chain: Chain): SourceName[] {
  return chain === "solana" ? ["dexscreener", "rugcheck", "goplus"] : ["dexscreener", "goplus"];
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isValidAddress(chain: Chain, address: string): boolean {
  return chain === "solana" ? SOLANA_ADDRESS.test(address) : EVM_ADDRESS.test(address);
}

/** Guess the chain from the address format (EVM addresses default to Ethereum). */
export function guessChain(address: string): Chain | undefined {
  if (EVM_ADDRESS.test(address)) return "ethereum";
  if (SOLANA_ADDRESS.test(address)) return "solana";
  return undefined;
}

/** Query every source for the chain in parallel; one failing source doesn't sink the scan. */
export async function scanToken(chain: Chain, address: string): Promise<TokenReport> {
  const names = sourcesFor(chain);
  const results = await Promise.allSettled(
    names.map((name) => cache.get(`${name}:${chain}:${address}`, () => FETCHERS[name](chain, address))),
  );

  const signals: SourceSignals[] = [];
  const errors: SourceError[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") signals.push(r.value);
    else errors.push({ source: names[i]!, message: (r.reason as Error)?.message ?? String(r.reason) });
  });
  if (signals.length === 0) {
    throw new Error(`All sources failed: ${errors.map((e) => `${e.source} (${e.message})`).join(", ")}`);
  }
  return analyze(chain, address, signals, errors);
}
