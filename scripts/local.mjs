import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const command = process.argv[2] === "start" ? "start" : "dev";
const port = process.env.PORT ?? "3000";
console.log("Raspberry local prototype — loopback access only. Google sign-in is not configured yet.");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", command, "--hostname", "127.0.0.1", "--port", port], {
  stdio: "inherit",
  env: { ...process.env, RASPBERRY_LOCAL_DEV: "1", RASPBERRY_AUTH_MODE: "local", APP_ORIGIN: `http://localhost:${port}` },
});
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
