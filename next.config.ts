import type { NextConfig } from "next";

// Deployment shape is derived from the same variables the access guard uses, so
// a hosted build cannot silently ship development-only policy.
const hosted = (process.env.RASPBERRY_PUBLIC_ORIGIN ?? "").trim() !== "";
const development = process.env.NODE_ENV === "development";

// WebSockets are needed for HMR in development only. A hosted deployment keeps
// connect-src at 'self' so a compromised document cannot reach other origins.
const connectSrc = development
  ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:*"
  : "connect-src 'self'";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  connectSrc,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(hosted ? ["upgrade-insecure-requests"] : []),
].join("; ");

const headers = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: csp },
  // allow-popups rather than same-origin: Google sign-in will need a popup or
  // redirect hand-off, and COOP same-origin severs window.opener for it.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(hosted
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const config: NextConfig = {
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers }];
  },
};
export default config;
