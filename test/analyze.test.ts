import { describe, expect, it } from "vitest";
import { analyze, verdictFor } from "../src/analysis/analyze.js";
import type { MarketData, SourceSignals } from "../src/types.js";

const NOW = Date.UTC(2026, 9, 7);
const ADDR = "So1aNaMemeCoin1111111111111111111111111111";

const market = (over: Partial<MarketData> = {}): SourceSignals => ({
  source: "dexscreener",
  flags: [],
  market: {
    name: "Test",
    symbol: "TST",
    liquidityUsd: 400_000,
    marketCapUsd: 5_000_000,
    pairCreatedAt: NOW - 30 * 86_400_000,
    websites: ["https://test.xyz"],
    socials: [],
    ...over,
  },
});

const ids = (r: ReturnType<typeof analyze>) => r.flags.map((f) => f.id);

describe("analyze", () => {
  it("rates a clean, established token as low risk", () => {
    const r = analyze(
      "solana",
      ADDR,
      [
        market(),
        {
          source: "rugcheck",
          flags: [],
          devHoldingsPct: 0,
          lpLockedPct: 100,
          mintAuthorityEnabled: false,
          freezeAuthorityEnabled: false,
          metadataMutable: false,
          holders: [
            { address: "pool", pct: 40, isPool: true },
            ...Array.from({ length: 12 }, (_, i) => ({ address: `h${i}`, pct: 1.5 })),
          ],
        },
      ],
      [],
      NOW,
    );
    expect(r.verdict).toBe("low");
    expect(r.top10HoldersPct).toBeCloseTo(15);
    expect(r.flags.every((f) => f.severity === "info")).toBe(true);
  });

  it("rates a classic rug setup as extreme", () => {
    const r = analyze(
      "solana",
      ADDR,
      [
        market({ liquidityUsd: 3_000, marketCapUsd: 400_000, pairCreatedAt: NOW - 20 * 60_000, websites: [] }),
        {
          source: "rugcheck",
          flags: [],
          devHoldingsPct: 35,
          lpLockedPct: 0,
          mintAuthorityEnabled: true,
          freezeAuthorityEnabled: true,
          holders: [
            { address: "dev", pct: 35, insider: true },
            { address: "w2", pct: 20 },
          ],
        },
      ],
      [],
      NOW,
    );
    expect(r.verdict).toBe("extreme");
    expect(ids(r)).toEqual(
      expect.arrayContaining(["mint-authority", "freeze-authority", "dev-holdings", "lp-unlocked", "low-liquidity", "new-token", "top10-concentration"]),
    );
    expect(r.flags.find((f) => f.id === "new-token")?.title).toContain("20 min");
    // Danger flags are sorted first.
    expect(r.flags[0]!.severity).toBe("danger");
  });

  it("takes the worse value when sources disagree", () => {
    const r = analyze(
      "solana",
      ADDR,
      [
        { source: "rugcheck", flags: [], devHoldingsPct: 2, lpLockedPct: 100, freezeAuthorityEnabled: false },
        { source: "goplus", flags: [], devHoldingsPct: 12, lpLockedPct: 60, freezeAuthorityEnabled: true },
      ],
      [],
      NOW,
    );
    expect(r.devHoldingsPct).toBe(12);
    expect(r.lpLockedPct).toBe(60);
    expect(ids(r)).toContain("freeze-authority");
  });

  it("pins honeypots and rugged tokens to 100", () => {
    const honeypot = analyze("base", "0x", [market(), { source: "goplus", flags: [], isHoneypot: true }], [], NOW);
    expect(honeypot.riskScore).toBe(100);
    const rugged = analyze("solana", ADDR, [{ source: "rugcheck", flags: [], rugged: true }], [], NOW);
    expect(rugged.riskScore).toBe(100);
  });

  it("warns when no security source answered", () => {
    const r = analyze("solana", ADDR, [market()], [{ source: "rugcheck", message: "HTTP 429" }], NOW);
    expect(ids(r)).toContain("no-security-data");
    expect(r.verdict).toBe("unknown");
    expect(r.errors).toHaveLength(1);
  });

  it("maps scores to verdicts", () => {
    expect([0, 19, 20, 44, 45, 69, 70, 100].map(verdictFor)).toEqual([
      "low", "low", "medium", "medium", "high", "high", "extreme", "extreme",
    ]);
  });
});
