import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

// Production entry point for the machine that hosts Raspberry.
//
// Two modes, and the startup check is deliberately stricter than "does it boot":
//
//   local   - requires RASPBERRY_LOCAL_DEV=1. Loopback only.
//   session - hosted. Requires an https public origin, a non-empty allowlist and a mail
//             sender. This list mirrors src/server/auth/config.ts, which is the authority
//             at request time; the duplication is on purpose, so a misconfigured
//             deployment fails loudly at startup instead of quietly serving 503s to the
//             one person who needs to get in.
//
//             Google is **not** on that list. It is an optional second factor: an install
//             with no OAuth client still signs its people in with the emailed code, and
//             requiring a client it never uses made a working deployment look broken.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const mode = process.env.RASPBERRY_AUTH_MODE === "session" ? "session" : "local";

if (mode === "session") {
  if (process.env.RASPBERRY_LOCAL_DEV === "1") {
    console.error("Raspberry: RASPBERRY_LOCAL_DEV=1 and RASPBERRY_AUTH_MODE=session are contradictory.");
    console.error("Local mode exists to bypass sign-in on one machine. Unset one of them.");
    process.exit(1);
  }

  const origin = (process.env.RASPBERRY_PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "");
  const allowlist = (process.env.RASPBERRY_ALLOWED_EMAILS ?? "").split(/[\s,;]+/).filter((entry) => entry.includes("@"));
  const mailBackend = (process.env.RASPBERRY_MAIL_BACKEND ?? "console").trim();
  const missing = [];
  if (!origin) missing.push("RASPBERRY_PUBLIC_ORIGIN");
  else if (!origin.startsWith("https://")) missing.push("RASPBERRY_PUBLIC_ORIGIN (must start with https://)");
  if (allowlist.length === 0) missing.push("RASPBERRY_ALLOWED_EMAILS (at least one address)");
  if (!process.env.RASPBERRY_MAIL_FROM) missing.push("RASPBERRY_MAIL_FROM");
  if (mailBackend === "http" && !process.env.RASPBERRY_MAIL_URL) missing.push("RASPBERRY_MAIL_URL");
  if (mailBackend === "smtp") {
    if (!process.env.RASPBERRY_SMTP_HOST) missing.push("RASPBERRY_SMTP_HOST");
    if (!process.env.RASPBERRY_SMTP_USER) missing.push("RASPBERRY_SMTP_USER");
    if (!process.env.RASPBERRY_SMTP_PASS) missing.push("RASPBERRY_SMTP_PASS");
  }
  if (mailBackend === "console" && process.env.RASPBERRY_MAIL_ALLOW_CONSOLE !== "1") {
    missing.push("RASPBERRY_MAIL_BACKEND=http, or RASPBERRY_MAIL_ALLOW_CONSOLE=1 to print login codes to this terminal");
  }
  // Half a Google client is a typo, not a choice: it would fall back to "no Google" and
  // look like it worked.
  if (Boolean(process.env.GOOGLE_CLIENT_ID) !== Boolean(process.env.GOOGLE_CLIENT_SECRET)) {
    missing.push(process.env.GOOGLE_CLIENT_ID ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID");
  }

  if (missing.length) {
    console.error("Raspberry will not start in session mode. Missing or invalid:");
    for (const entry of missing) console.error(`  - ${entry}`);
    console.error("Refusing to start: a hosted deployment that cannot authenticate anyone is not a safe default.");
    process.exit(1);
  }
  if (process.env.RASPBERRY_TRUST_PROXY !== "1") {
    console.warn("Raspberry: RASPBERRY_TRUST_PROXY is not 1. Rate limiting will treat every caller as one address.");
  }
}

const hostname = process.env.RASPBERRY_HOST ?? "127.0.0.1";
const port = process.env.PORT ?? "3000";
console.log(`Raspberry starting on http://${hostname}:${port} in ${mode} mode`);

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", hostname, "--port", port], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
