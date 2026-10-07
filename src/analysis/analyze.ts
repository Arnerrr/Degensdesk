import type { Chain, Flag, Holder, SourceError, SourceSignals, TokenReport, Verdict } from "../types.js";

// Thresholds are deliberately in one place so they're easy to tune.
export const THRESHOLDS = {
  devHoldingsDangerPct: 20,
  devHoldingsWarnPct: 5,
  top10DangerPct: 50,
  top10WarnPct: 30,
  singleHolderWarnPct: 10,
  lpLockedDangerPct: 50,
  lpLockedWarnPct: 90,
  taxDangerPct: 10,
  taxWarnPct: 5,
  liquidityDangerUsd: 5_000,
  liquidityWarnUsd: 25_000,
  liquidityToMcapWarnPct: 2,
  newTokenHours: 24,
} as const;

const SEVERITY_POINTS = { danger: 25, warn: 10, info: 0 } as const;

const pct = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}%`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Combine what every source said into a single report with a risk score. */
export function analyze(
  chain: Chain,
  address: string,
  signals: SourceSignals[],
  errors: SourceError[] = [],
  now = Date.now(),
): TokenReport {
  const bySource = (name: SourceSignals["source"]) => signals.find((s) => s.source === name);
  const any = (pick: (s: SourceSignals) => boolean | undefined) => {
    const values = signals.map(pick).filter((v): v is boolean => v !== undefined);
    return values.length ? values.some(Boolean) : undefined;
  };
  const numbers = (pick: (s: SourceSignals) => number | undefined) =>
    signals.map(pick).filter((v): v is number => v !== undefined);

  const market = bySource("dexscreener")?.market;
  // Be conservative when sources disagree: assume the worse number.
  const devValues = numbers((s) => s.devHoldingsPct);
  const devHoldingsPct = devValues.length ? Math.max(...devValues) : undefined;
  const lpValues = numbers((s) => s.lpLockedPct);
  const lpLockedPct = lpValues.length ? Math.min(...lpValues) : undefined;
  const taxValues = (pick: (s: SourceSignals) => number | undefined) => {
    const v = numbers(pick);
    return v.length ? Math.max(...v) : undefined;
  };
  const buyTaxPct = taxValues((s) => s.buyTaxPct);
  const sellTaxPct = taxValues((s) => s.sellTaxPct);

  // RugCheck has the richest Solana holder data (insiders, AMM labels); fall back to GoPlus.
  const holders: Holder[] =
    [bySource("rugcheck"), bySource("goplus")].map((s) => s?.holders).find((h) => h && h.length > 0) ?? [];
  const realHolders = holders.filter((h) => !h.isPool).sort((a, b) => b.pct - a.pct);
  const top10HoldersPct = realHolders.length ? realHolders.slice(0, 10).reduce((s, h) => s + h.pct, 0) : undefined;

  const flags: Flag[] = [];
  const add = (f: Omit<Flag, "source"> & { source?: Flag["source"] }) =>
    flags.push({ ...f, source: f.source ?? "dexscreener" });

  const rugged = any((s) => s.rugged);
  const honeypot = any((s) => s.isHoneypot);
  if (rugged) add({ id: "rugged", severity: "danger", title: "Already marked as rugged", source: "rugcheck" });
  if (honeypot) {
    add({ id: "honeypot", severity: "danger", title: "Honeypot: buys work, sells don't", source: "goplus" });
  }

  if (any((s) => s.mintAuthorityEnabled)) {
    add({
      id: "mint-authority",
      severity: chain === "solana" ? "danger" : "warn",
      title: chain === "solana" ? "Mint authority not revoked" : "Supply is mintable",
      detail: "The dev can print new tokens and dump them on holders.",
      source: sourceOf(signals, (s) => s.mintAuthorityEnabled),
    });
  }
  if (any((s) => s.freezeAuthorityEnabled)) {
    add({
      id: "freeze-authority",
      severity: "danger",
      title: "Freeze authority not revoked",
      detail: "The dev can freeze your tokens so you can't sell.",
      source: sourceOf(signals, (s) => s.freezeAuthorityEnabled),
    });
  }
  if (any((s) => s.metadataMutable)) {
    add({
      id: "metadata-mutable",
      severity: "warn",
      title: "Metadata is mutable",
      detail: "Name, symbol or image can be changed after launch.",
      source: sourceOf(signals, (s) => s.metadataMutable),
    });
  }

  if (devHoldingsPct !== undefined) {
    const severity =
      devHoldingsPct >= THRESHOLDS.devHoldingsDangerPct
        ? "danger"
        : devHoldingsPct >= THRESHOLDS.devHoldingsWarnPct
          ? "warn"
          : "info";
    add({
      id: "dev-holdings",
      severity,
      title: severity === "info" ? `Dev holds ${pct(devHoldingsPct)}` : `Dev holds ${pct(devHoldingsPct)} of supply`,
      detail: severity === "info" ? undefined : "A large dev bag can be dumped on buyers at any time.",
      source: sourceOf(signals, (s) => s.devHoldingsPct !== undefined),
    });
  }

  if (top10HoldersPct !== undefined) {
    if (top10HoldersPct >= THRESHOLDS.top10WarnPct) {
      add({
        id: "top10-concentration",
        severity: top10HoldersPct >= THRESHOLDS.top10DangerPct ? "danger" : "warn",
        title: `Top 10 wallets hold ${pct(top10HoldersPct)}`,
        detail: "Excludes liquidity pools and lockers.",
        source: holdersSource(signals, holders),
      });
    }
    const whale = realHolders[0];
    if (whale && whale.pct >= THRESHOLDS.singleHolderWarnPct) {
      add({
        id: "whale",
        severity: "warn",
        title: `One wallet holds ${pct(whale.pct)}`,
        detail: whale.address,
        source: holdersSource(signals, holders),
      });
    }
    const insiderPct = realHolders.filter((h) => h.insider).reduce((s, h) => s + h.pct, 0);
    if (insiderPct > 0 && (devHoldingsPct === undefined || insiderPct > devHoldingsPct + 1)) {
      add({
        id: "insider-holdings",
        severity: insiderPct >= THRESHOLDS.devHoldingsDangerPct ? "danger" : "warn",
        title: `Insider wallets hold ${pct(insiderPct)}`,
        source: holdersSource(signals, holders),
      });
    }
  }

  if (lpLockedPct !== undefined && lpLockedPct < THRESHOLDS.lpLockedWarnPct) {
    add({
      id: "lp-unlocked",
      severity: lpLockedPct < THRESHOLDS.lpLockedDangerPct ? "danger" : "warn",
      title: `Only ${pct(lpLockedPct)} of liquidity is locked or burned`,
      detail: "Unlocked LP can be pulled — the classic rug.",
      source: sourceOf(signals, (s) => s.lpLockedPct !== undefined),
    });
  }

  for (const [side, tax] of [
    ["Sell", sellTaxPct],
    ["Buy", buyTaxPct],
  ] as const) {
    if (tax !== undefined && tax >= THRESHOLDS.taxWarnPct) {
      add({
        id: `${side.toLowerCase()}-tax`,
        severity: tax >= THRESHOLDS.taxDangerPct ? "danger" : "warn",
        title: `${side} tax is ${pct(tax)}`,
        source: "goplus",
      });
    }
  }

  if (market) {
    const liq = market.liquidityUsd ?? 0;
    if (liq < THRESHOLDS.liquidityWarnUsd) {
      add({
        id: "low-liquidity",
        severity: liq < THRESHOLDS.liquidityDangerUsd ? "danger" : "warn",
        title: `Low liquidity (${usd(liq)})`,
        detail: "Even small sells will move the price a lot.",
      });
    }
    const mcap = market.marketCapUsd ?? market.fdvUsd;
    if (mcap && liq > 0 && (liq / mcap) * 100 < THRESHOLDS.liquidityToMcapWarnPct) {
      add({
        id: "thin-liquidity",
        severity: "warn",
        title: "Liquidity is thin for the market cap",
        detail: `${usd(liq)} liquidity vs ${usd(mcap)} market cap.`,
      });
    }
    if (market.pairCreatedAt) {
      const hours = (now - market.pairCreatedAt) / 3_600_000;
      if (hours < THRESHOLDS.newTokenHours) {
        add({
          id: "new-token",
          severity: "warn",
          title: `Brand new: trading for ${hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${Math.round(hours)}h`}`,
        });
      }
    }
    if (market.websites.length === 0 && market.socials.length === 0) {
      add({ id: "no-socials", severity: "info", title: "No website or socials listed" });
    }
  }

  // Source-specific findings that have no normalised field.
  for (const s of signals) {
    for (const f of s.flags) if (!flags.some((x) => x.id === f.id)) flags.push(f);
  }

  const securitySources = signals.filter((s) => s.source !== "dexscreener");
  if (securitySources.length === 0) {
    flags.push({
      id: "no-security-data",
      severity: "warn",
      title: "Security checks unavailable",
      detail: "Only market data could be fetched — the score below can't see contract risks.",
      source: "dexscreener",
    });
  }

  const order = { danger: 0, warn: 1, info: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);

  const riskScore =
    rugged || honeypot ? 100 : Math.min(100, flags.reduce((sum, f) => sum + SEVERITY_POINTS[f.severity], 0));

  return {
    chain,
    address,
    scannedAt: new Date(now).toISOString(),
    market,
    devHoldingsPct,
    top10HoldersPct,
    lpLockedPct,
    topHolders: [...holders].sort((a, b) => b.pct - a.pct).slice(0, 20),
    flags,
    riskScore,
    verdict: securitySources.length === 0 && !rugged && !honeypot ? "unknown" : verdictFor(riskScore),
    sources: signals.map((s) => s.source),
    errors,
  };
}

export function verdictFor(score: number): Exclude<Verdict, "unknown"> {
  if (score >= 70) return "extreme";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function sourceOf(signals: SourceSignals[], has: (s: SourceSignals) => boolean | undefined): Flag["source"] {
  return signals.find((s) => has(s))?.source ?? "dexscreener";
}

function holdersSource(signals: SourceSignals[], holders: Holder[]): Flag["source"] {
  return signals.find((s) => s.holders === holders)?.source ?? "dexscreener";
}
