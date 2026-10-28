export function localAccessError(headers: Headers, method: string, enabled = process.env.RASPBERRY_LOCAL_DEV, appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000"): string | null {
  if (enabled !== "1") return "Raspberry authentication is not configured. Public access is disabled.";
  let configured: URL;
  try { configured = new URL(appOrigin); } catch { return "APP_ORIGIN is invalid."; }
  if (configured.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname)) return "Local mode requires a loopback APP_ORIGIN.";
  const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"].map((host) => `${host}${configured.port ? `:${configured.port}` : ""}`));
  if (!allowedHosts.has(headers.get("host") ?? "")) return "This prototype only accepts loopback hosts.";
  const origin = headers.get("origin");
  if (origin) {
    try { const parsed = new URL(origin); if (parsed.protocol !== "http:" || !allowedHosts.has(parsed.host)) return "Cross-origin requests are not allowed."; }
    catch { return "Invalid request origin."; }
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && (!origin || headers.get("sec-fetch-site") === "cross-site")) return "A same-origin browser request is required.";
  return null;
}
