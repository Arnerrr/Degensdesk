import { describe, expect, it } from "vitest";
import { parseDexScreener, parseLatestProfiles } from "../src/sources/dexscreener.js";
import { parseGoPlus } from "../src/sources/goplus.js";
import { parseRugCheck } from "../src/sources/rugcheck.js";

const MINT = "So1aNaMemeCoin1111111111111111111111111111";

describe("dexscreener", () => {
  const pair = (over: Record<string, unknown>) => ({
    chainId: "solana",
    dexId: "raydium",
    url: "https://dexscreener.com/solana/pair",
    baseToken: { address: MINT, name: "Degen Cat", symbol: "DCAT" },
    priceUsd: "0.0012",
    liquidity: { usd: 10_000 },
    fdv: 1_200_000,
    marketCap: 1_100_000,
    volume: { h24: 50_000 },
    priceChange: { h24: -12.5 },
    pairCreatedAt: 1_700_000_000_000,
    ...over,
  });

  it("uses the deepest pair for price and sums liquidity", () => {
    const s = parseDexScreener(
      {
        pairs: [
          pair({ priceUsd: "0.001", liquidity: { usd: 5_000 }, pairCreatedAt: 1_600_000_000_000 }),
          pair({ dexId: "pumpswap", liquidity: { usd: 20_000 }, info: { socials: [{ type: "twitter", url: "https://x.com/dcat" }] } }),
          pair({ chainId: "base", liquidity: { usd: 999_999 } }),
        ],
      },
      "solana",
      MINT,
    );
    expect(s.market).toMatchObject({
      name: "Degen Cat",
      dexId: "pumpswap",
      priceUsd: 0.0012,
      liquidityUsd: 25_000,
      pairCreatedAt: 1_600_000_000_000,
      socials: [{ type: "twitter", url: "https://x.com/dcat" }],
    });
  });

  it("flags tokens with no pairs", () => {
    const s = parseDexScreener({ pairs: null }, "solana", MINT);
    expect(s.market).toBeUndefined();
    expect(s.flags.map((f) => f.id)).toEqual(["no-pairs"]);
  });

  it("parses the latest profiles feed", () => {
    expect(parseLatestProfiles([{ chainId: "solana", tokenAddress: MINT }, { chainId: "solana" }])).toEqual([
      { chain: "solana", address: MINT, url: undefined, icon: undefined, description: undefined },
    ]);
  });
});

describe("rugcheck", () => {
  const report = {
    mint: MINT,
    creator: "DevWallet111",
    creatorBalance: 150_000_000,
    token: { mintAuthority: null, freezeAuthority: "FreezeAuth111", supply: 1_000_000_000, decimals: 6 },
    tokenMeta: { name: "Degen Cat", symbol: "DCAT", mutable: true },
    topHolders: [
      { address: "PoolTokenAcct", owner: "RaydiumAuthority", pct: 30, insider: false },
      { address: "DevTokenAcct", owner: "DevWallet111", pct: 15, insider: false },
      { address: "Acct3", owner: "Whale3", pct: 4, insider: true },
    ],
    knownAccounts: { RaydiumAuthority: { name: "Raydium", type: "AMM" } },
    markets: [{ lp: { lpLockedPct: 40 } }, { lp: { lpLockedPct: 100 } }],
    risks: [
      { name: "Freeze Authority still enabled", level: "danger", score: 5000 },
      { name: "Low amount of LP Providers", level: "warn", description: "Only a few users are providing liquidity" },
    ],
    rugged: false,
    graphInsidersDetected: 7,
  };

  it("normalises authorities, dev bag, LP lock and holders", () => {
    const s = parseRugCheck(report);
    expect(s).toMatchObject({
      creator: "DevWallet111",
      devHoldingsPct: 15,
      lpLockedPct: 100,
      mintAuthorityEnabled: false,
      freezeAuthorityEnabled: true,
      metadataMutable: true,
      rugged: undefined,
    });
    expect(s.holders).toEqual([
      { address: "RaydiumAuthority", pct: 30, insider: false, isPool: true },
      { address: "DevWallet111", pct: 15, insider: true, isPool: false },
      { address: "Whale3", pct: 4, insider: true, isPool: false },
    ]);
  });

  it("keeps only risks that aren't covered by normalised fields", () => {
    const ids = parseRugCheck(report).flags.map((f) => f.id);
    expect(ids).toEqual(["rugcheck:low-amount-of-lp-providers", "insider-network"]);
  });
});

describe("goplus", () => {
  const EVM = "0x1111111111111111111111111111111111111111";

  it("parses EVM token security with fractional percentages", () => {
    const s = parseGoPlus(
      {
        code: 1,
        result: {
          [EVM]: {
            is_honeypot: "0",
            buy_tax: "0.03",
            sell_tax: "0.9",
            is_mintable: "1",
            is_open_source: "0",
            creator_address: "0xdev",
            owner_address: "0x0000000000000000000000000000000000000000",
            creator_percent: "0.08",
            owner_percent: "0",
            holders: [
              { address: "0xpool", percent: "0.5", is_locked: 0, tag: "UniswapV2" },
              { address: "0xdev", percent: "0.08", is_locked: 0 },
            ],
            lp_holders: [
              { address: "0x000000000000000000000000000000000000dead", percent: "0.6", is_locked: 0 },
              { address: "0xlocker", percent: "0.3", is_locked: 1 },
              { address: "0xdev", percent: "0.1", is_locked: 0 },
            ],
            slippage_modifiable: "1",
          },
        },
      },
      "ethereum",
      EVM,
    );
    expect(s.buyTaxPct).toBeCloseTo(3);
    expect(s.sellTaxPct).toBeCloseTo(90);
    expect(s.devHoldingsPct).toBeCloseTo(8);
    expect(s.lpLockedPct).toBeCloseTo(90);
    expect(s.mintAuthorityEnabled).toBe(true);
    expect(s.isHoneypot).toBe(false);
    expect(s.holders?.[1]).toMatchObject({ address: "0xdev", insider: true });
    expect(s.flags.map((f) => f.id).sort()).toEqual(["closed-source", "tax-modifiable"]);
  });

  it("parses Solana token security", () => {
    const s = parseGoPlus(
      {
        code: 1,
        result: {
          [MINT]: {
            mintable: { status: "0" },
            freezable: { status: "1" },
            metadata_mutable: { status: "0" },
            balance_mutable_authority: { status: "1" },
            creators: [{ address: "DevWallet111", malicious_address: 0 }],
            holders: [
              { account: "DevWallet111", percent: "0.2" },
              { account: "Other", percent: "0.05" },
            ],
          },
        },
      },
      "solana",
      MINT,
    );
    expect(s).toMatchObject({ mintAuthorityEnabled: false, freezeAuthorityEnabled: true, metadataMutable: false });
    expect(s.devHoldingsPct).toBeCloseTo(20);
    expect(s.flags.map((f) => f.id)).toEqual(["balance-mutable"]);
  });

  it("throws on API errors", () => {
    expect(() => parseGoPlus({ code: 4029, message: "rate limited" }, "solana", MINT)).toThrow(/rate limited/);
  });
});
