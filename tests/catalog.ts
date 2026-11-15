/* The two catalog questions the suite asks about the schema it just built.
 *
 * `databases.test.ts` used to answer them with `sqlite_master` and `PRAGMA table_info`,
 * which are SQLite's catalog and only SQLite's. That is fine while the suite ran on one
 * engine and wrong the moment it could run on PostgreSQL — the test failed with
 * `relation "sqlite_master" does not exist`, which is not a bug in Raspberry, just a test
 * asking the wrong dialect where the tables were.
 *
 * Asking the question through here keeps the assertion (the four tables exist, `pages`
 * gained `database_id`) and drops the dialect: SQLite answers from its own catalog,
 * PostgreSQL from `information_schema`, and both are restricted to the schema in use so an
 * isolated fixture cannot see a neighbour's tables.
 */
import type { Database } from "../src/server/database";
import { testDatabaseUrl } from "./schema";

const onPostgres = () => /^postgres(ql)?:\/\//.test(testDatabaseUrl());

/** Table names visible to the fixture that is asking. */
export async function tableNames(db: Database): Promise<string[]> {
  const rows = await db.transaction((sql) =>
    onPostgres()
      ? sql.query<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()")
      : sql.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
  );
  return rows.map((row) => String(row.name));
}

/** Column names of one table, as that table currently exists. */
export async function columnNames(db: Database, table: string): Promise<string[]> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error(`not a table name: ${table}`);
  const rows = await db.transaction((sql) =>
    onPostgres()
      ? sql.query<{ name: string }>("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1", [table])
      : sql.query<{ name: string }>(`PRAGMA table_info(${table})`)
  );
  return rows.map((row) => String(row.name));
}
