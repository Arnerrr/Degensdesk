import { getJson } from "../http.js";
import type { Chain, Flag, Holder, SourceSignals } from "../types.js";
import { arr, flag01, num, obj, str, type Obj } from "./parse.js";

const BASE = "https://api.gopluslabs.io/api/v1";

const EVM_CHAIN_IDS: Record<Exclude<Chain, "solana">, string> = {
  ethereum: "1",
  bsc: "56",
  base: "8453",
};

const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

export async function fetchGoPlus(chain: Chain, address: string): Promise<SourceSignals> {
  const token = process.env.GOPLUS_ACCESS_TOKEN;
  const headers = token ? { Authorization: token } : undefined;
  const q = `contract_addresses=${encodeURIComponent(address)}`;
  const url =
    chain === "solana" ? `${BASE}/solana/token_security?${q}` : `${BASE}/token_security/${EVM_CHAIN_IDS[chain]}?${q}`;
  const json = await getJson(url, headers);
  return parseGoPlus(json, chain, address);
}

export function parseGoPlus(json: unknown, chain: Chain, address: string): SourceSignals {
  const body = obj(json);
  if (body && num(body.code) !== 1) {
    throw new Error(`GoPlus error: ${str(body.message) ?? "unknown"}`);
  }
  const result = obj(body?.result) ?? {};
  const data = obj(result[address]) ?? obj(result[address.toLowerCase()]) ?? obj(Object.values(result)[0]);
  if (!data) throw new Error("GoPlus returned no data for this token");
  return chain === "solana" ? parseSolana(data) : parseEvm(data);
}

/** GoPlus single-value percentages (taxes, creator_percent) are fractions: 0.12 = 12%. */
function fraction(value: unknown): number | undefined {
  const n = num(value);
  return n === undefined ? undefined : n * 100;
}

/**
 * Holder lists are fractions too, but to be safe against a list reported in
 * 0-100 we check the total: fractions of one supply can't sum past 1.
 */
function toPct(values: (number | undefined)[]): (number | undefined)[] {
  const total = values.reduce<number>((s, v) => s + (v ?? 0), 0);
  const scale = total > 1.5 ? 1 : 100;
  return values.map((v) => (v === undefined ? undefined : v * scale));
}

function parseHolders(list: unknown[], insiders: Set<string>, addrKey: string): Holder[] {
  const rows = list.map(obj).filter((h): h is Obj => !!h);
  const pcts = toPct(rows.map((h) => num(h.percent)));
  return rows
    .map((h, i) => {
      const address = str(h[addrKey]) ?? str(h.address) ?? "";
      const locked = flag01(h.is_locked) === true;
      return {
        address,
        pct: pcts[i] ?? 0,
        insider: insiders.has(address.toLowerCase()),
        isPool: locked || BURN_ADDRESSES.has(address.toLowerCase()) || /pool|lock|burn|amm/i.test(str(h.tag) ?? ""),
      };
    })
    .filter((h) => h.address);
}

function parseSolana(data: Obj): SourceSignals {
  const status = (key: string) => flag01(obj(data[key])?.status);
  const creators = arr(data.creators)
    .map((c) => str(obj(c)?.address)?.toLowerCase())
    .filter((a): a is string => !!a);
  const holders = parseHolders(arr(data.holders), new Set(creators), "account");
  const flags: Flag[] = [];

  if (status("closable")) {
    flags.push({ id: "closable", severity: "warn", title: "Token accounts can be closed by authority", source: "goplus" });
  }
  if (status("balance_mutable_authority")) {
    flags.push({
      id: "balance-mutable",
      severity: "danger",
      title: "Authority can change balances",
      detail: "An authority can modify holder balances directly.",
      source: "goplus",
    });
  }
  if (flag01(data.non_transferable)) {
    flags.push({ id: "non-transferable", severity: "danger", title: "Token is non-transferable", source: "goplus" });
  }
  if (arr(data.transfer_hook).length > 0) {
    flags.push({
      id: "transfer-hook",
      severity: "warn",
      title: "Transfer hook present",
      detail: "Custom code runs on every transfer and could block sells.",
      source: "goplus",
    });
  }
  if (arr(data.creators).some((c) => flag01(obj(c)?.malicious_address))) {
    flags.push({ id: "malicious-creator", severity: "danger", title: "Creator wallet flagged as malicious", source: "goplus" });
  }

  const devFromHolders = holders.filter((h) => h.insider).reduce((s, h) => s + h.pct, 0);
  return {
    source: "goplus",
    holders,
    creator: creators[0],
    devHoldingsPct: creators.length ? devFromHolders : undefined,
    mintAuthorityEnabled: status("mintable"),
    freezeAuthorityEnabled: status("freezable"),
    metadataMutable: status("metadata_mutable"),
    flags,
  };
}

function parseEvm(data: Obj): SourceSignals {
  const creator = str(data.creator_address)?.toLowerCase();
  const owner = str(data.owner_address)?.toLowerCase();
  const insiders = new Set([creator, owner].filter((a): a is string => !!a && !BURN_ADDRESSES.has(a)));
  const holders = parseHolders(arr(data.holders), insiders, "address");

  const lpRows = arr(data.lp_holders).map(obj).filter((h): h is Obj => !!h);
  const lpPcts = toPct(lpRows.map((h) => num(h.percent)));
  const lpLockedPct = lpRows.length
    ? lpRows.reduce((s, h, i) => {
        const addr = str(h.address)?.toLowerCase() ?? "";
        return flag01(h.is_locked) || BURN_ADDRESSES.has(addr) ? s + (lpPcts[i] ?? 0) : s;
      }, 0)
    : undefined;

  const creatorPct = fraction(data.creator_percent);
  const ownerPct = fraction(data.owner_percent);
  const devHoldingsPct =
    creatorPct === undefined && ownerPct === undefined
      ? undefined
      : creator === owner
        ? (creatorPct ?? ownerPct)
        : (creatorPct ?? 0) + (ownerPct ?? 0);

  const flags: Flag[] = [];
  const check = (key: string, id: string, severity: Flag["severity"], title: string, detail?: string) => {
    if (flag01(data[key])) flags.push({ id, severity, title, detail, source: "goplus" });
  };
  check("cannot_sell_all", "cannot-sell-all", "danger", "Holders cannot sell their full balance");
  check("transfer_pausable", "transfer-pausable", "warn", "Owner can pause transfers");
  check("hidden_owner", "hidden-owner", "danger", "Hidden owner");
  check("can_take_back_ownership", "reclaim-ownership", "danger", "Ownership can be reclaimed after renouncing");
  check("is_blacklisted", "blacklist", "warn", "Contract has a blacklist", "The owner can block specific wallets from trading.");
  check("slippage_modifiable", "tax-modifiable", "danger", "Owner can change buy/sell tax");
  check("owner_change_balance", "balance-mutable", "danger", "Owner can change balances");
  check("selfdestruct", "selfdestruct", "danger", "Contract can self-destruct");
  check("is_proxy", "proxy", "warn", "Upgradeable proxy contract", "The contract logic can be swapped out.");
  if (flag01(data.is_open_source) === false) {
    flags.push({ id: "closed-source", severity: "danger", title: "Contract source is not verified", source: "goplus" });
  }

    return {
    source: "goplus",
    holders,
    creator,
    devHoldingsPct,
    lpLockedPct,
    mintAuthorityEnabled: flag01(data.is_mintable),
    isHoneypot: flag01(data.is_honeypot),
    buyTaxPct: fraction(data.buy_tax),
    sellTaxPct: fraction(data.sell_tax),
    flags,
  };
}
