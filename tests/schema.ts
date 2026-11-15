/* Page tests used to open the *baseline* DDL — the schema as it was first shipped, not the
   one a running server has. `migrate()` is what the runtime calls before it serves a
   request, and page order (`position`, migration 4) is the first column the service writes
   that the baseline does not define, so those fixtures now open a migrated database the way
   `auth-login.test.ts` and `session-store.test.ts` always have.

   The URL is the seam that lets the same suite run on PostgreSQL (B4). Unset — which is how
   `pnpm test` and CI run it — every fixture opens `file::memory:` as before. With
   `RASPBERRY_TEST_DATABASE_URL` pointing at a *scratch* server, the fixtures open that
   server instead, so the code that ships is the code that gets exercised.

   `file::memory:` gives every open its own empty database, and the suite was written against
   that: several tests count rows and expect only their own. A PostgreSQL server is shared by
   default, so a plain URL turned those counts into "expected 2, actual 9" — file A's pages
   showing up in file B's assertions. `isolated` restores the semantics that made the fixtures
   honest: one open, one empty namespace, nothing destructive, and no schema of another test
   within reach of a query that forgot its WHERE clause.
*/
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { openDatabase, type Database } from "../src/server/database";
import { migrate } from "../src/server/migrations";

export function testDatabaseUrl(): string {
  return process.env.RASPBERRY_TEST_DATABASE_URL ?? "file::memory:";
}

const isPostgres = (url: string) => /^postgres(ql)?:\/\//.test(url);

/**
 * Points one fixture at a schema nothing else can see.
 *
 * A schema rather than a database because `CREATE DATABASE` cannot run inside the
 * maintenance connection's transaction-free state cheaply, and rather than a
 * `DROP SCHEMA public CASCADE` because a mistyped URL must never be able to delete data.
 * Schemas are left behind on purpose: the scratch server is disposable, and cleaning up
 * would mean guessing when a fixture is finished (a test file may hold its handle open for
 * the whole run).
 */
async function isolated(url: string): Promise<string> {
  const schema = `fixture_${randomUUID().replace(/-/g, "")}`;
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.end();
  }
  const parsed = new URL(url);
  // No space in `-csearch_path=…`: libpq accepts the joined form, and it survives the
  // percent-encoding that `URL` applies to a query value without needing "+" to mean a space.
  parsed.searchParams.set("options", `-csearch_path=${schema}`);
  return parsed.toString();
}

export async function openMigrated(url = testDatabaseUrl()): Promise<Database> {
  const database = await openDatabase(isPostgres(url) ? await isolated(url) : url);
  await migrate(database);
  return database;
}
