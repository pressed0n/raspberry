import { baselineStatements, type Database, type Sql } from "./database";
import { createPageLink, documentSchema, pageReferences, plainText } from "../lib/document";

/**
 * Versioned schema migrations.
 *
 * `schema_migrations` was written by the baseline DDL and by one ad-hoc data fix,
 * but nothing ever read it — so adding a table meant hand-editing `seed()`, and
 * `CREATE TABLE IF NOT EXISTS` would silently no-op on an existing database and
 * leave it without the new column. This runner is the fix: applied versions are
 * read once, pending ones run in ascending order, and each migration records its
 * own version **inside the same transaction as its work**. A crash mid-migration
 * therefore leaves neither the change nor the version row.
 *
 * Rules for writing one:
 *   - `up` receives `sql` only. Do not call `database.transaction` inside it; the
 *     runner already opened one, and the SQLite adapter cannot nest transactions.
 *   - Prefer `IF NOT EXISTS` even though the version row should prevent re-runs.
 *     Version rows can be absent on a database that predates this runner.
 *   - Never edit an applied migration. Add a new version instead.
 */
export type Migration = { version: number; name: string; up(sql: Sql): Promise<void> };

const baseline: Migration = {
  version: 1,
  name: "baseline schema",
  async up(sql) {
    // Every statement is idempotent, so replaying this on a database that predates
    // the runner is a no-op that only costs the version row.
    for (const statement of baselineStatements) await sql.query(statement);
  },
};

const childPageLinks: Migration = {
  version: 2,
  name: "append child page links to their parents",
  async up(sql) {
    // Historical data fix: pages created under a parent predate the inline link
    // block that the editor renders, so each parent needs one appended.
    //
    // This used to run from `seed()` through the service layer, which meant a data
    // migration also wrote revision snapshots and idempotency receipts. Rewritten
    // as plain SQL: it touches content, the derived search text, and the revision
    // counter, and nothing else.
    const children = await sql.query(
      "SELECT c.id, c.title, c.workspace_id, c.parent_id FROM pages c JOIN pages p ON p.id=c.parent_id AND p.workspace_id=c.workspace_id WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY c.created_at,c.id",
    );
    for (const child of children) {
      const [parent] = await sql.query("SELECT id, content FROM pages WHERE id=$1 AND workspace_id=$2", [child.parent_id, child.workspace_id]);
      if (!parent) continue;
      // A page whose stored content no longer matches the document schema is left
      // alone rather than blocking startup. The link is cosmetic; corrupting or
      // truncating an unparseable document would not be.
      const parsed = documentSchema.safeParse(JSON.parse(String(parent.content)));
      if (!parsed.success) continue;
      if (pageReferences(parsed.data).includes(String(child.id))) continue;
      const next = documentSchema.parse([...parsed.data, createPageLink({ id: String(child.id), title: String(child.title) }, "child")]);
      // `workspace_id` comes from the child, not the parent row: the projection above
      // only selects `id` and `content`, and binding `undefined` for the parent's
      // workspace silently matched no rows when this was written the other way.
      await sql.query("UPDATE pages SET content=$1, plain_text=$2, revision=revision+1 WHERE id=$3 AND workspace_id=$4", [
        JSON.stringify(next),
        plainText(next),
        String(parent.id),
        String(child.workspace_id),
      ]);
    }
  },
};

export const migrations: readonly Migration[] = [baseline, childPageLinks];

export type MigrationResult = { applied: number[]; version: number };

/**
 * Applies every migration the database has not recorded yet.
 *
 * Throws if the database reports a version this build does not define: that means
 * the binary is older than the schema, and running it would be guessing about
 * columns it has never seen.
 */
export async function migrate(database: Database, plan: readonly Migration[] = migrations): Promise<MigrationResult> {
  const byVersion = new Map<number, Migration>();
  for (const migration of plan) {
    if (byVersion.has(migration.version)) throw new Error(`Duplicate migration version ${migration.version} (${migration.name}).`);
    byVersion.set(migration.version, migration);
  }
  const ordered = [...plan].sort((left, right) => left.version - right.version);
  const rows = await database.transaction((sql) => sql.query<{ version: number }>("SELECT version FROM schema_migrations"));
  const applied = new Set(rows.map((row) => Number(row.version)));
  const unknown = [...applied].filter((version) => !byVersion.has(version)).sort((left, right) => left - right);
  if (unknown.length) {
    throw new Error(
      `Database is at schema version ${Math.max(...unknown)} and this build does not define ${unknown.join(", ")}. Refusing to run against a newer schema.`,
    );
  }
  const ran: number[] = [];
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    await database.transaction(async (sql) => {
      await migration.up(sql);
      await sql.query("INSERT INTO schema_migrations(version) VALUES($1)", [migration.version]);
    });
    ran.push(migration.version);
  }
  return { applied: ran, version: Math.max(0, ...applied, ...ran) };
}
