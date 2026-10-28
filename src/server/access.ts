import { localAccessError } from "./local-access";

/**
 * How requests are admitted at the transport layer.
 *
 * - `local`   : loopback-only. This is the only mode that can currently serve
 *               data. It is what `pnpm dev` / `pnpm preview` select.
 * - `session` : the hosted path (public domain, TLS, Google sign-in + email
 *               code). The transport checks below are reviewed and tested, but
 *               the mode refuses every request until session authentication
 *               exists, so it cannot be opened by accident.
 */
export type AccessMode = "local" | "session";

export const HOSTED_AUTH_PENDING =
  "Hosted access is disabled until session authentication is implemented.";

export function accessMode(): AccessMode {
  return process.env.RASPBERRY_AUTH_MODE === "session" ? "session" : "local";
}

export type HostedAccessOptions = {
  /** Canonical public origin, e.g. `https://raspberry.example.com`. */
  publicOrigin: string;
  /** Extra Host header values accepted, for a proxy that rewrites Host. */
  trustedHosts?: readonly string[];
  /** Extra browser origins accepted, e.g. a second custom domain. */
  extraOrigins?: readonly string[];
  /** Reject requests a TLS proxy marked as non-https. Defaults to true. */
  requireHttps?: boolean;
};

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Transport-level checks for a publicly reachable deployment.
 *
 * Mirrors the loopback guard: the Host header is allow-listed (DNS-rebinding
 * defence), browser mutations must carry an allow-listed Origin (CSRF
 * defence), and requests a trusted proxy marked as plaintext are refused.
 */
export function hostedTransportError(
  headers: Headers,
  method: string,
  options: HostedAccessOptions,
): string | null {
  let publicUrl: URL;
  try {
    publicUrl = new URL(options.publicOrigin);
  } catch {
    return "RASPBERRY_PUBLIC_ORIGIN is not a valid URL.";
  }
  if (publicUrl.protocol !== "https:") return "Hosted mode requires an https RASPBERRY_PUBLIC_ORIGIN.";
  if (publicUrl.username !== "" || publicUrl.password !== "") return "RASPBERRY_PUBLIC_ORIGIN must not contain credentials.";
  if (publicUrl.pathname !== "/" || publicUrl.search !== "" || publicUrl.hash !== "") return "RASPBERRY_PUBLIC_ORIGIN must be a bare origin without a path.";

  const trustedHosts = new Set<string>([publicUrl.host.toLowerCase()]);
  for (const entry of options.trustedHosts ?? []) trustedHosts.add(entry.toLowerCase());
  if (!trustedHosts.has((headers.get("host") ?? "").toLowerCase())) return "This host is not allowed.";

  const allowedOrigins = new Set<string>([publicUrl.origin]);
  for (const entry of options.extraOrigins ?? []) {
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      return `${entry} is not a valid extra origin.`;
    }
    if (parsed.protocol !== "https:") return `${entry} must be an https origin.`;
    allowedOrigins.add(parsed.origin);
  }

  const rawOrigin = headers.get("origin");
  if (rawOrigin !== null) {
    let parsed: URL;
    try {
      parsed = new URL(rawOrigin);
    } catch {
      return "Invalid request origin.";
    }
    if (parsed.protocol !== "https:" || !allowedOrigins.has(parsed.origin)) return "Cross-origin requests are not allowed.";
  }

  const safeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (!safeMethod) {
    if (!rawOrigin) return "A same-origin browser request is required.";
    if (headers.get("sec-fetch-site") === "cross-site") return "A same-origin browser request is required.";
  }

  if (options.requireHttps !== false) {
    const forwardedProto = headers.get("x-forwarded-proto");
    if (forwardedProto !== null && forwardedProto.split(",")[0]!.trim().toLowerCase() !== "https") {
      return "Hosted requests must arrive over HTTPS.";
    }
  }

  return null;
}

function configuredHostedOptions(): HostedAccessOptions {
  return {
    publicOrigin: (process.env.RASPBERRY_PUBLIC_ORIGIN ?? "").trim(),
    trustedHosts: list(process.env.RASPBERRY_TRUSTED_HOSTS),
    extraOrigins: list(process.env.RASPBERRY_EXTRA_ORIGINS),
    requireHttps: process.env.RASPBERRY_REQUIRE_HTTPS !== "0",
  };
}

/**
 * The single entry point used by `proxy.ts` and by `api()`. Returns a message
 * to deny the request, or null to allow it.
 *
 * `session` mode intentionally never returns null: the transport checks run
 * first so misconfiguration is reported accurately, and the request is then
 * refused until sessions exist. Replacing the final return with a real session
 * lookup is the whole of the remaining access work.
 */
export function requestAccessError(
  headers: Headers,
  method: string,
  options?: HostedAccessOptions,
): string | null {
  if (accessMode() === "local") return localAccessError(headers, method);
  const transport = hostedTransportError(headers, method, options ?? configuredHostedOptions());
  if (transport !== null) return transport;
  return HOSTED_AUTH_PENDING;
}
