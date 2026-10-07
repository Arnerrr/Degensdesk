const $ = (sel) => document.querySelector(sel);

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Only allow http(s) links from third-party data into href/src.
const safeUrl = (url) => (/^https?:\/\//i.test(url ?? "") ? esc(url) : "");

const usd = (n) => {
  if (n === undefined || n === null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(n < 1 ? 6 : 2)}`;
};
const pct = (n) => (n === undefined || n === null ? "—" : `${n.toFixed(n < 10 ? 2 : 1)}%`);
const age = (ms) => {
  if (!ms) return "—";
  const mins = (Date.now() - ms) / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
};
const verdictColor = (v) => `var(--${v})`;

function renderReport(r) {
  const m = r.market ?? {};
  const links = [
    m.pairUrl && `<a href="${safeUrl(m.pairUrl)}" target="_blank" rel="noopener">Chart ↗</a>`,
    r.chain === "solana" && `<a href="https://rugcheck.xyz/tokens/${esc(r.address)}" target="_blank" rel="noopener">RugCheck ↗</a>`,
    ...(m.websites ?? []).map((u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">Website ↗</a>`),
    ...(m.socials ?? []).map((s) => `<a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${esc(s.type)} ↗</a>`),
  ].filter(Boolean);

  const holders = r.topHolders.length
    ? `<h3>Top holders</h3>
       <table><tbody>${r.topHolders
         .slice(0, 10)
         .map(
           (h, i) => `<tr><td>${i + 1}</td><td class="addr">${esc(h.address)}${
             h.isPool ? '<span class="tag">pool / lock</span>' : ""
           }${h.insider ? '<span class="tag insider">dev / insider</span>' : ""}</td><td class="num">${pct(h.pct)}</td></tr>`,
         )
         .join("")}</tbody></table>`
    : "";

  return `
    <div class="card">
      <div class="token-head">
        ${m.imageUrl ? `<img src="${safeUrl(m.imageUrl)}" alt="" />` : ""}
        <div>
          <div class="token-name">${esc(m.name ?? "Unknown token")} <span class="muted">${esc(m.symbol ?? "")}</span></div>
          <div class="token-addr">${esc(r.chain)} · ${esc(r.address)}</div>
        </div>
        <div class="score">
          <div class="score-num v-${r.verdict}">${r.riskScore}</div>
          <div class="score-label v-${r.verdict}">${r.verdict === "unknown" ? "risk unknown" : `${r.verdict} risk`}</div>
        </div>
      </div>
      <div class="meter"><div style="width:${r.riskScore}%;background:${verdictColor(r.verdict)}"></div></div>
      <div class="stats">
        <div class="stat"><div class="stat-label">Price</div><div class="stat-value">${usd(m.priceUsd)}</div></div>
        <div class="stat"><div class="stat-label">Market cap</div><div class="stat-value">${usd(m.marketCapUsd ?? m.fdvUsd)}</div></div>
        <div class="stat"><div class="stat-label">Liquidity</div><div class="stat-value">${usd(m.liquidityUsd)}</div></div>
        <div class="stat"><div class="stat-label">24h volume</div><div class="stat-value">${usd(m.volume24hUsd)}</div></div>
        <div class="stat"><div class="stat-label">Age</div><div class="stat-value">${age(m.pairCreatedAt)}</div></div>
        <div class="stat"><div class="stat-label">Dev holdings</div><div class="stat-value">${pct(r.devHoldingsPct)}</div></div>
        <div class="stat"><div class="stat-label">Top 10 holders</div><div class="stat-value">${pct(r.top10HoldersPct)}</div></div>
        <div class="stat"><div class="stat-label">LP locked/burned</div><div class="stat-value">${pct(r.lpLockedPct)}</div></div>
      </div>
      <h3>Findings</h3>
      <ul class="flags">
        ${
          r.flags.length
            ? r.flags
                .map(
                  (f) => `<li class="flag ${f.severity}"><div><div class="flag-title">${esc(f.title)}</div>${
                    f.detail ? `<div class="flag-detail">${esc(f.detail)}</div>` : ""
                  }</div><span class="flag-src">${esc(f.source)}</span></li>`,
                )
                .join("")
            : '<li class="flag"><div class="flag-title">No red flags found</div></li>'
        }
      </ul>
      ${holders}
      ${r.errors.length ? `<p class="muted">Unavailable: ${r.errors.map((e) => `${esc(e.source)} (${esc(e.message)})`).join(", ")}</p>` : ""}
      ${links.length ? `<div class="links">${links.join("")}</div>` : ""}
    </div>`;
}

async function scan(address, chain) {
  const btn = $("#scan-form button");
  btn.disabled = true;
  $("#result").innerHTML = '<div class="card muted">Scanning DexScreener, RugCheck and GoPlus…</div>';
  try {
    const qs = new URLSearchParams({ address });
    if (chain) qs.set("chain", chain);
    const res = await fetch(`/api/scan?${qs}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    $("#result").innerHTML = renderReport(body);
    history.replaceState(null, "", `?${qs}`);
  } catch (err) {
    $("#result").innerHTML = `<div class="card error">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

async function loadFeed() {
  const feed = $("#feed");
  const btn = $("#refresh-feed");
  btn.disabled = true;
  try {
    const res = await fetch("/api/feed");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    feed.innerHTML = body.items.length
      ? body.items
          .map((r) => {
            const m = r.market ?? {};
            const worst = r.flags.find((f) => f.severity !== "info");
            return `<button class="feed-item" type="button" data-address="${esc(r.address)}" data-chain="${esc(r.chain)}">
              ${m.imageUrl ? `<img src="${safeUrl(m.imageUrl)}" alt="" />` : '<img alt="" />'}
              <div class="meta">
                <div><strong>${esc(m.symbol ?? "?")}</strong> <span class="muted">${esc(m.name ?? "")} · ${esc(r.chain)} · ${age(m.pairCreatedAt)}</span></div>
                <div class="sub">${worst ? esc(worst.title) : "No major flags"} · liq ${usd(m.liquidityUsd)}</div>
              </div>
              <span class="pill v-${r.verdict}">${r.riskScore}</span>
            </button>`;
          })
          .join("")
      : '<p class="muted">No new tokens right now.</p>';
  } catch (err) {
    feed.innerHTML = `<p class="error">Couldn't load feed: ${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

$("#scan-form").addEventListener("submit", (e) => {
  e.preventDefault();
  scan($("#address").value.trim(), $("#chain").value);
});

$("#feed").addEventListener("click", (e) => {
  const item = e.target.closest(".feed-item");
  if (!item) return;
  $("#address").value = item.dataset.address;
  $("#chain").value = item.dataset.chain;
  scan(item.dataset.address, item.dataset.chain);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

$("#refresh-feed").addEventListener("click", loadFeed);

const params = new URLSearchParams(location.search);
if (params.get("address")) {
  $("#address").value = params.get("address");
  $("#chain").value = params.get("chain") ?? "";
  scan(params.get("address"), params.get("chain"));
}
loadFeed();
