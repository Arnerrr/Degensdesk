import { getJson } from "../http.js";
import type { Chain, MarketData, SourceSignals } from "../types.js";
import { arr, num, obj, str } from "./parse.js";

const BASE = "https://api.dexscreener.com";

export async function fetchDexScreener(chain: Chain, address: string): Promise<SourceSignals> {
  const json = await getJson(`${BASE}/latest/dex/tokens/${encodeURIComponent(address)}`);
  return parseDexScreener(json, chain, address);
}

/** Market data from the token's trading pairs. Uses the deepest pair for price. */
export function parseDexScreener(json: unknown, chain: Chain, address: string): SourceSignals {
  const want = address.toLowerCase();
  const pairs = arr(obj(json)?.pairs)
    .map(obj)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .filter((p) => p.chainId === chain && str(obj(p.baseToken)?.address)?.toLowerCase() === want);

  const signals: SourceSignals = { source: "dexscreener", flags: [] };
  if (pairs.length === 0) {
    signals.flags.push({
      id: "no-pairs",
      severity: "warn",
      title: "No trading pairs found",
      detail: "DexScreener has no pairs for this token on this chain.",
      source: "dexscreener",
    });
    return signals;
  }

  const liq = (p: (typeof pairs)[number]) => num(obj(p.liquidity)?.usd) ?? 0;
  const best = pairs.reduce((a, b) => (liq(b) > liq(a) ? b : a));
  const created = pairs.map((p) => num(p.pairCreatedAt)).filter((n): n is number => n !== undefined);
  const info = obj(best.info);
  const base = obj(best.baseToken);

  const market: MarketData = {
    name: str(base?.name),
    symbol: str(base?.symbol),
    priceUsd: num(best.priceUsd),
    liquidityUsd: pairs.reduce((sum, p) => sum + liq(p), 0),
    fdvUsd: num(best.fdv),
    marketCapUsd: num(best.marketCap),
    volume24hUsd: num(obj(best.volume)?.h24),
    priceChange24hPct: num(obj(best.priceChange)?.h24),
    pairCreatedAt: created.length ? Math.min(...created) : undefined,
    pairUrl: str(best.url),
    dexId: str(best.dexId),
    imageUrl: str(info?.imageUrl),
    websites: arr(info?.websites)
      .map((w) => str(obj(w)?.url))
      .filter((u): u is string => !!u),
    socials: arr(info?.socials)
      .map(obj)
      .map((s) => ({ type: str(s?.type) ?? "link", url: str(s?.url) ?? "" }))
      .filter((s) => s.url),
  };
  signals.market = market;
  return signals;
}

export interface FeedItem {
  chain: string;
  address: string;
  url?: string;
  icon?: string;
  description?: string;
}

/** Newest token profiles on DexScreener — a stream of freshly launched tokens. */
export async function fetchLatestProfiles(): Promise<FeedItem[]> {
  const json = await getJson(`${BASE}/token-profiles/latest/v1`);
  return parseLatestProfiles(json);
}

export function parseLatestProfiles(json: unknown): FeedItem[] {
  return arr(json)
    .map(obj)
    .map((p) => ({
      chain: str(p?.chainId) ?? "",
      address: str(p?.tokenAddress) ?? "",
      url: str(p?.url),
      icon: str(p?.icon),
      description: str(p?.description),
    }))
    .filter((p) => p.chain && p.address);
}
