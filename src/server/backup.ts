import { backup, DatabaseSync } from "node:sqlite";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Consistent SQLite snapshot, including committed WAL data. Never overwrites an existing backup. */
export async function backupSqlite(databaseUrl: string, destination: string) {
  if (!databaseUrl.startsWith("file:") || databaseUrl === "file::memory:") throw new Error("This backup command requires a file-based SQLite database. Use pg_dump for PostgreSQL.");
  const path = resolve(destination);
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx"); await handle.close();
  const source = new DatabaseSync(resolve(databaseUrl.slice(5)), { readOnly: true });
  try { await backup(source, path); } finally { source.close(); }
  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    const check = copy.prepare("PRAGMA integrity_check").get();
    if (check?.integrity_check !== "ok") throw new Error("Backup integrity check failed.");
  } finally { copy.close(); }
  return path;
}
