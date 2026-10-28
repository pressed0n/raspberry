import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

export interface Sql { query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>; }
export interface Database { transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>; close(): Promise<void>; }
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
// The baseline is expressed as individual statements rather than one blob so the
// migration runner can replay it through `sql.query` (which executes a single
// statement at a time). `openDatabase` still applies the joined form on connect,
// so a database is usable even if nothing ever calls `migrate()`; the runner then
// records version 1 and owns everything after it.
export const baselineStatements: readonly string[] = [
  "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)",
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS memberships (user_id TEXT REFERENCES users(id), workspace_id TEXT REFERENCES workspaces(id), role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')), PRIMARY KEY(user_id, workspace_id))",
  `CREATE TABLE IF NOT EXISTS pages (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), parent_id TEXT REFERENCES pages(id),
 title TEXT NOT NULL, icon TEXT NOT NULL, content TEXT NOT NULL, plain_text TEXT NOT NULL,
 favorite INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, schema_version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, trash_batch TEXT
)`,
  "CREATE INDEX IF NOT EXISTS pages_workspace ON pages(workspace_id, deleted_at)",
  "CREATE INDEX IF NOT EXISTS pages_parent ON pages(parent_id)",
  "CREATE TABLE IF NOT EXISTS revisions (page_id TEXT NOT NULL REFERENCES pages(id), revision INTEGER NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL, client_id TEXT NOT NULL, PRIMARY KEY(page_id, revision))",
  "CREATE TABLE IF NOT EXISTS mutations (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, client_id TEXT NOT NULL, mutation_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id,client_id,mutation_id))",
];

const schema = baselineStatements.map((statement) => `${statement};`).join("\n");

export async function openDatabase(url = process.env.DATABASE_URL ?? "file:./data/raspberry.sqlite"): Promise<Database> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pool = new Pool({ connectionString: url, max: 5 });
    // Serialize schema setup across app/MCP processes sharing the same database.
    const client = await pool.connect();
    let initialized = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(72617370)");
      await client.query(schema);
      await client.query("COMMIT");
      initialized = true;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); if (!initialized) await pool.end(); }
    return {
      async transaction(work) {
        const connection: PoolClient = await pool.connect();
        try {
          await connection.query("BEGIN");
          // Pilot-wide transaction lock matches SQLite's single-writer model and
          // keeps document changes, revision history, and retry receipts atomic.
          await connection.query("SELECT pg_advisory_xact_lock(72617371)");
          const result = await work({ query: async <T extends Record<string, unknown>>(text: string, values?: unknown[]) => (await connection.query<T>(text, values)).rows });
          await connection.query("COMMIT"); return result;
        } catch (error) { await connection.query("ROLLBACK"); throw error; }
        finally { connection.release(); }
      },
      async close() { await pool.end(); },
    };
  }
  if (!url.startsWith("file:")) throw new Error("DATABASE_URL must use file: or postgres://.");
  const filename = url.slice(5) === ":memory:" ? ":memory:" : resolve(url.slice(5));
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  database.exec(schema);
  let queue = Promise.resolve();
  return {
    transaction(work) {
      const result = queue.then(async () => {
        database.exec("BEGIN IMMEDIATE");
        try {
          const value = await work({ query: async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => {
            const ordered: unknown[] = [];
            const positional = text.replace(/\$(\d+)/g, (_, index: string) => { ordered.push(values[Number(index) - 1]); return "?"; });
            return database.prepare(positional).all(...ordered as (string | number | null)[]) as T[];
          } });
          database.exec("COMMIT"); return value;
        } catch (error) { database.exec("ROLLBACK"); throw error; }
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
    async close() { await queue; database.close(); },
  };
}
