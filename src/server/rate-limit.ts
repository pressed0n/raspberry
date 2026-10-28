/**
 * Per-process fixed-window rate limiting.
 *
 * This is deliberately small: Raspberry runs as a single Node process on one
 * machine, so an in-memory window is honest and sufficient. If the app ever runs
 * multi-instance, this moves to a shared store — the call sites do not change.
 *
 * The bounds also cap the damage from a runaway client-side save loop: an
 * unfixed retry storm stops with a 429 instead of hammering the database.
 */
type Window = { count: number; resetAt: number };

const globalStore = globalThis as typeof globalThis & { raspberryRateWindows?: Map<string, Window> };

function store(): Map<string, Window> {
  globalStore.raspberryRateWindows ??= new Map<string, Window>();
  return globalStore.raspberryRateWindows;
}

const READ = { limit: 600, windowMs: 60_000 };
const WRITE = { limit: 240, windowMs: 60_000 };

function bucketFor(method: string) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS" ? READ : WRITE;
}

/** The client address, but only when a trusted proxy vouched for it. */
export function callerIp(headers: Headers): string | null {
  if (process.env.RASPBERRY_TRUST_PROXY !== "1") return null;
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim();
  return first ? first : null;
}

function callerKey(headers: Headers, bucket: string): string {
  return `${bucket}:${callerIp(headers) ?? "direct"}`;
}

function sweep(now: number): void {
  const windows = store();
  if (windows.size < 5_000) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/** Records one request. Returns true when the caller is still within budget. */
export function consume(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const windows = store();
  const current = windows.get(key);
  if (current === undefined || current.resetAt <= now) {
    sweep(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

/** A tighter budget for one endpoint, keyed by its own name. */
export type RateLimitOptions = { bucket: string; limit: number; windowMs: number };

/** Returns a message when the caller is over budget, otherwise null. */
export function rateLimitError(headers: Headers, method: string, now = Date.now(), options?: RateLimitOptions): string | null {
  if (options) {
    const allowed = consume(callerKey(headers, options.bucket), options.limit, options.windowMs, now);
    return allowed ? null : "Too many requests. Wait a moment and try again.";
  }
  const bucket = method === "GET" || method === "HEAD" || method === "OPTIONS" ? "read" : "write";
  const { limit, windowMs } = bucketFor(method);
  const allowed = consume(callerKey(headers, bucket), limit, windowMs, now);
  return allowed ? null : "Too many requests. Wait a moment and try again.";
}
