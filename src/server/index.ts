import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { TtlCache } from "../http.js";
import { guessChain, isValidAddress, scanToken } from "../scanner.js";
import { fetchLatestProfiles } from "../sources/dexscreener.js";
import { isChain, type TokenReport } from "../types.js";

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const FEED_SIZE = 12;
const FEED_CONCURRENCY = 3;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handleScan(url: URL, res: ServerResponse) {
  const address = url.searchParams.get("address")?.trim() ?? "";
  const chainParam = url.searchParams.get("chain")?.trim();
  const chain = chainParam ? (isChain(chainParam) ? chainParam : undefined) : guessChain(address);
  if (!chain) return sendJson(res, 400, { error: "Unknown chain or unrecognised address format." });
  if (!isValidAddress(chain, address)) return sendJson(res, 400, { error: `Not a valid ${chain} token address.` });
  sendJson(res, 200, await scanToken(chain, address));
}

const feedCache = new TtlCache<{ items: TokenReport[]; errors: string[] }>(30_000);

/** Newest token launches, each scanned. Limited concurrency to stay under API rate limits. */
async function buildFeed() {
  const profiles = (await fetchLatestProfiles())
    .flatMap(({ chain, address }) => (isChain(chain) && isValidAddress(chain, address) ? [{ chain, address }] : []))
    .slice(0, FEED_SIZE);
  const items: TokenReport[] = [];
  const errors: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < profiles.length) {
      const p = profiles[next++]!;
      try {
        items.push(await scanToken(p.chain, p.address));
      } catch (err) {
        errors.push(`${p.address}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: FEED_CONCURRENCY }, worker));
  items.sort((a, b) => (b.market?.pairCreatedAt ?? 0) - (a.market?.pairCreatedAt ?? 0));
  return { items, errors };
}

async function serveStatic(pathname: string, res: ServerResponse) {
  const rel = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Forbidden" });
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  if (url.pathname === "/api/scan") return handleScan(url, res);
  if (url.pathname === "/api/feed") return sendJson(res, 200, await feedCache.get("feed", buildFeed));
  if (url.pathname === "/api/health") return sendJson(res, 200, { ok: true });
  return serveStatic(url.pathname, res);
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 502, { error: (err as Error).message });
    else res.end();
  });
}).listen(PORT, () => console.log(`Degensdesk running at http://localhost:${PORT}`));
