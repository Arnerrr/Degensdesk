import { getJson } from "../http.js";
import type { Flag, Holder, Severity, SourceSignals } from "../types.js";
import { arr, num, obj, str } from "./parse.js";

const BASE = "https://api.rugcheck.xyz/v1";

/** RugCheck only covers Solana. */
export async function fetchRugCheck(mint: string): Promise<SourceSignals> {
  const json = await getJson(`${BASE}/tokens/${encodeURIComponent(mint)}/report`);
  return parseRugCheck(json);
}

// Risks RugCheck reports that we already derive from normalised fields,
// so they'd show up twice in the report.
const COVERED_RISKS = [
  /mint authority/i,
  /freeze authority/i,
  /mutable metadata/i,
  /top 10 holders/i,
  /lp unlocked/i,
  /creator.*(balance|holding)/i,
];

const POOL_ACCOUNT_TYPES = new Set(["AMM", "LOCKER", "BURN"]);

export function parseRugCheck(json: unknown): SourceSignals {
  const report = obj(json) ?? {};
  const token = obj(report.token);
  const meta = obj(report.tokenMeta);
  const known = obj(report.knownAccounts) ?? {};
  const creator = str(report.creator);

  const holders: Holder[] = arr(report.topHolders)
    .map(obj)
    .map((h) => {
      const address = str(h?.address) ?? "";
      const owner = str(h?.owner);
      const type = str(obj(known[owner ?? ""])?.type) ?? str(obj(known[address])?.type);
      return {
        address: owner ?? address,
        pct: num(h?.pct) ?? 0,
        insider: h?.insider === true || (!!creator && owner === creator) || type === "CREATOR",
        isPool: type !== undefined && POOL_ACCOUNT_TYPES.has(type),
      };
    })
    .filter((h) => h.address);

  const supply = num(token?.supply);
  const creatorBalance = num(report.creatorBalance);
  const devHoldingsPct =
    supply && creatorBalance !== undefined ? Math.min(100, (creatorBalance / supply) * 100) : undefined;

  const lockedPcts = arr(report.markets)
    .map((m) => num(obj(obj(m)?.lp)?.lpLockedPct))
    .filter((n): n is number => n !== undefined);

  const flags: Flag[] = arr(report.risks)
    .map(obj)
    .filter((r): r is NonNullable<typeof r> => !!r && !!str(r.name))
    .filter((r) => !COVERED_RISKS.some((re) => re.test(str(r.name)!)))
    .map((r) => ({
      id: `rugcheck:${str(r.name)!.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      severity: toSeverity(str(r.level)),
      title: str(r.name)!,
      detail: [str(r.description), str(r.value)].filter(Boolean).join(" — ") || undefined,
      source: "rugcheck" as const,
    }));

  const insiderNetworks = arr(report.insiderNetworks).length;
  if (report.graphInsidersDetected && num(report.graphInsidersDetected)! > 0) {
    flags.push({
      id: "insider-network",
      severity: "danger",
      title: "Insider wallet network detected",
      detail: `${num(report.graphInsidersDetected)} linked insider wallets${insiderNetworks ? ` across ${insiderNetworks} networks` : ""}.`,
      source: "rugcheck",
    });
  }

  return {
    source: "rugcheck",
    holders,
    creator,
    devHoldingsPct,
    lpLockedPct: lockedPcts.length ? Math.max(...lockedPcts) : undefined,
    mintAuthorityEnabled: token ? token.mintAuthority != null : undefined,
    freezeAuthorityEnabled: token ? token.freezeAuthority != null : undefined,
    metadataMutable: typeof meta?.mutable === "boolean" ? meta.mutable : undefined,
    rugged: report.rugged === true ? true : undefined,
    flags,
  };
}

function toSeverity(level: string | undefined): Severity {
  if (level === "danger") return "danger";
  if (level === "warn" || level === "warning") return "warn";
  return "info";
}
