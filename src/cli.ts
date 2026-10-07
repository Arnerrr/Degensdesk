import { guessChain, isValidAddress, scanToken } from "./scanner.js";
import { isChain, type Severity } from "./types.js";

const ICON: Record<Severity, string> = { danger: "✖", warn: "!", info: "·" };

async function main() {
  const args = process.argv.slice(2);
  const chainIdx = args.indexOf("--chain");
  const chainArg = chainIdx >= 0 ? args.splice(chainIdx, 2)[1] : undefined;
  const json = args.includes("--json");
  const address = args.find((a) => !a.startsWith("--"));

  if (!address) {
    console.error("Usage: npm run scan -- <token address> [--chain solana|ethereum|base|bsc] [--json]");
    process.exit(1);
  }
  const chain = chainArg ? (isChain(chainArg) ? chainArg : undefined) : guessChain(address);
  if (!chain || !isValidAddress(chain, address)) {
    console.error(`Not a valid token address${chain ? ` for ${chain}` : ""}: ${address}`);
    process.exit(1);
  }

  const r = await scanToken(chain, address);
  if (json) return console.log(JSON.stringify(r, null, 2));

  const m = r.market;
  console.log(`\n${m?.name ?? "Unknown"} (${m?.symbol ?? "?"}) on ${r.chain}\n${r.address}`);
  console.log(`\nRisk: ${r.riskScore}/100 — ${r.verdict.toUpperCase()}`);
  if (m?.priceUsd !== undefined) console.log(`Price: $${m.priceUsd}  Liquidity: $${Math.round(m.liquidityUsd ?? 0)}`);
  if (r.devHoldingsPct !== undefined) console.log(`Dev holdings: ${r.devHoldingsPct.toFixed(2)}%`);
  if (r.top10HoldersPct !== undefined) console.log(`Top 10 holders: ${r.top10HoldersPct.toFixed(2)}%`);
  if (r.lpLockedPct !== undefined) console.log(`LP locked/burned: ${r.lpLockedPct.toFixed(2)}%`);
  console.log("");
  for (const f of r.flags) console.log(` ${ICON[f.severity]} ${f.title}${f.detail ? ` — ${f.detail}` : ""} [${f.source}]`);
  for (const e of r.errors) console.log(` ? ${e.source} unavailable: ${e.message}`);
  console.log(`\nSources: ${r.sources.join(", ") || "none"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
