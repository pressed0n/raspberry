import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

// Production entry point for the machine that hosts Raspberry.
//
// It deliberately does NOT enable local mode for you: without RASPBERRY_LOCAL_DEV=1
// in the environment, the service refuses to start, which is the fail-closed
// default. `pnpm preview` is the supported way to run a built app locally.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

if (process.env.RASPBERRY_AUTH_MODE === "session") {
  console.error("Raspberry is not ready to serve hosted traffic: session authentication is not implemented.");
  console.error("Unset RASPBERRY_AUTH_MODE, or use `pnpm preview`, until that work is finished.");
  process.exit(1);
}

const hostname = process.env.RASPBERRY_HOST ?? "127.0.0.1";
const port = process.env.PORT ?? "3000";
console.log(`Raspberry starting on http://${hostname}:${port}`);

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", hostname, "--port", port], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
