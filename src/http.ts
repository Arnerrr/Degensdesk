const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** GET a JSON document with a timeout; throws HttpError on any failure. */
export async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "degensdesk/0.1", ...headers },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new HttpError(`request failed: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new HttpError(`invalid JSON from ${new URL(url).host}`, res.status);
  }
}

/** Small in-memory TTL cache so repeated scans don't hammer rate-limited APIs. */
export class TtlCache<T> {
  private entries = new Map<string, { value: Promise<T>; expires: number }>();

  constructor(private ttlMs: number) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) return hit.value;
    const value = load();
    this.entries.set(key, { value, expires: now + this.ttlMs });
    // Don't cache failures.
    value.catch(() => this.entries.delete(key));
    return value;
  }
}
