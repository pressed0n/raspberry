import { existsSync } from "node:fs";
import { join } from "node:path";
import { backupSqlite } from "../src/server/backup";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const destination = join("data", "backups", `raspberry-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.sqlite`);
console.log(await backupSqlite(process.env.DATABASE_URL ?? "file:./data/raspberry.sqlite", destination));
