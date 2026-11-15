/**
 * Move an existing `data/raspberry.sqlite` workspace into PostgreSQL.
 *
 * Why this exists: changing `DATABASE_URL` does not move a single row. The
 * adapter in `src/server/database.ts` opens *a* database; it does not copy one.
 * A hosted deployment pointed at an empty PostgreSQL server shows an empty
 * workspace, and the notes stay behind on the laptop as the only copy.
 *
 * Three decisions worth knowing:
 *
 * 1. **Ids are preserved.** `RASPBERRY_OWNER_EMAIL` adopts the existing local
 *    workspace on first sign-in by matching the user id, so rewriting ids here
 *    would silently orphan every page the migration just copied.
 *
 * 2. **Trash is copied as trash.** Only rows are moved, never deleted, and
 *    `deleted_at` travels with the page. "Clean up while we are here" is how an
 *    owner loses pages, and there is no undo on the other side.
 *
 * 3. **The column list is the intersection, not a literal.** Columns are read
 *    from both sides at run time, so a migration older than the source database
 *    copies what both sides have instead of failing on a column added since.
 *
 * The source is opened `readOnly`. Nothing in this script writes to SQLite.
 *
 * Usage:
 *   tsx scripts/migrate-to-postgres.ts --dry-run
 *   tsx scripts/migrate-to-postgres.ts --url postgres://…
 *   tsx scripts/migrate-to-postgres.ts --url … --sqlite data/raspberry.sqlite
 *
 * `--url` wins over `DATABASE_URL`, which is the point: the same command moves
 * the same data into a probe branch first and production second.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase, type Database, type Sql } from "../src/server/database";
import { migrate } from "../src/server/migrations";

/**
 * Order matters twice: parents before children for the foreign keys, and
 * `schema_migrations` is absent on purpose — the runner owns that table, and a
 * copied version row would tell it work had happened on a database where it
 * had not.
 *
 * `sessions`, `accounts`, `login_challenges` and `auth_events` are absent for
 * the opposite reason: they are per-machine authentication state. Copying a
 * session id to a host would be handing a live credential to a different
 * origin, and the hosted deployment issues its own on sign-in.
 */
const TABLES = [
  "users",
  "workspaces",
  "memberships",
  "pages",
  "revisions",
  "mutations",
  "files",
  "databases",
  "database_properties",
  "database_views",
  "database_cells",
] as const;

/** Rows per INSERT. 500 keeps the statement well under PostgreSQL's parameter cap. */
const CHUNK = 500;

type Args = { url: string; sqlite: string; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const url = get("--url") ?? process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      "Target must be a PostgreSQL URL. Pass --url postgres://… or set DATABASE_URL. " +
        "Refusing to run against SQLite: this tool's whole job is the other direction."
    );
  }
  return {
    url,
    sqlite: resolve(get("--sqlite") ?? "data/raspberry.sqlite"),
    dryRun: argv.includes("--dry-run"),
  };
}

const columnsOf = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((row) => row.name);

async function pgColumns(sql: Sql, table: string): Promise<string[]> {
  const rows = await sql.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
    [table]
  );
  return rows.map((row) => row.column_name);
}

/** `$1, $2, … $n` — the adapter rewrites these to `?` for SQLite. */
const placeholders = (count: number): string =>
  Array.from({ length: count }, (_, index) => `$${index + 1}`).join(", ");

/** One `(…), (…)` tuple per row, with the parameter numbers continuing across rows. */
const tuples = (rows: number, columns: number): string =>
  Array.from({ length: rows }, (_, row) =>
    `(${placeholders(columns).replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + row * columns}`)})`
  ).join(", ");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.sqlite)) throw new Error(`Source database not found: ${args.sqlite}`);

  const source = new DatabaseSync(args.sqlite, { readOnly: true });
  const target: Database = await openDatabase(args.url);
  await migrate(target);

  const report: { table: string; rows: number }[] = [];

  try {
    await target.transaction(async (sql) => {
      for (const table of TABLES) {
        const sourceColumns = columnsOf(source, table);
        if (sourceColumns.length === 0) continue;
        const targetColumns = await pgColumns(sql, table);
        const columns = sourceColumns.filter((name) => targetColumns.includes(name));
        const missing = sourceColumns.filter((name) => !targetColumns.includes(name));
        if (missing.length) {
          console.warn(`  ${table}: skipping columns absent from PostgreSQL — ${missing.join(", ")}`);
        }
        if (columns.length === 0) continue;

        const rows = source
          .prepare(`SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM "${table}"`)
          .all() as Record<string, unknown>[];
        if (args.dryRun) {
          report.push({ table, rows: rows.length });
          continue;
        }

        for (let start = 0; start < rows.length; start += CHUNK) {
          const slice = rows.slice(start, start + CHUNK);
          // `ON CONFLICT DO NOTHING` without a target covers every unique
          // constraint, so a second run is a no-op rather than a duplicate-key
          // crash halfway through a workspace.
          await sql.query(
            `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) ` +
              `VALUES ${tuples(slice.length, columns.length)} ` +
              `ON CONFLICT DO NOTHING`,
            slice.flatMap((row) => columns.map((column) => row[column] ?? null))
          );
        }
        report.push({ table, rows: rows.length });
      }
    });
  } finally {
    source.close();
    await target.close();
  }

  const total = report.reduce((sum, row) => sum + row.rows, 0);
  console.log(args.dryRun ? "\nDry run — nothing written.\n" : "\nCopied.\n");
  for (const row of report) {
    console.log(`  ${row.table.padEnd(22)} ${String(row.rows).padStart(6)} in source`);
  }
  console.log(`\n  ${String(total).padStart(6)} rows total`);
  if (!args.dryRun) console.log("\nRe-run the same command to confirm idempotence: it must report zero new rows.");
}

await main();
