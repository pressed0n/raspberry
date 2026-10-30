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

/**
 * Authentication tables.
 *
 * Deliberately additive only: every statement creates a new object, and nothing
 * here alters an existing table. `ALTER TABLE ... ADD COLUMN` with a constraint is
 * not portable across SQLite and Postgres, and column-presence detection differs
 * between them (`PRAGMA table_info` versus `information_schema`), so an additive
 * migration is the one shape that behaves identically on both engines.
 *
 * Timestamps stay ISO-8601 TEXT to match the rest of the schema. Comparison is
 * lexicographic, which is correct for this format, and every expiry decision is
 * also re-checked in JavaScript rather than trusted to the query.
 */
const authSchema: Migration = {
  version: 3,
  name: "authentication: accounts, sessions, login challenges, audit events",
  async up(sql) {
    // A provider identity. One row per (provider, subject) — Google's `sub` is the
    // subject, never the email, because an email can be reassigned at a provider
    // and a subject cannot.
    for (const statement of [
      "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL, subject TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT, created_at TEXT NOT NULL, last_login_at TEXT, disabled_at TEXT)",
      "CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_subject ON accounts(provider, subject)",
      "CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_provider ON accounts(user_id, provider)",
      "CREATE INDEX IF NOT EXISTS accounts_email ON accounts(email)",
      // An opaque session. `token_hash` is SHA-256 of the secret in the cookie, so a
      // copy of this table cannot be replayed as a login.
      "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id), created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, idle_expires_at TEXT NOT NULL, absolute_expires_at TEXT NOT NULL, revoked_at TEXT, revoked_reason TEXT, ip_hash TEXT, user_agent_hash TEXT)",
      "CREATE UNIQUE INDEX IF NOT EXISTS sessions_token ON sessions(token_hash)",
      "CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)",
      "CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(idle_expires_at)",
      // The OAuth round trip and the emailed code share one row, so the second factor
      // is bound to the identity the first factor proved. A code cannot be replayed
      // against a different account because the challenge names the subject.
      "CREATE TABLE IF NOT EXISTS login_challenges (id TEXT PRIMARY KEY, state_hash TEXT NOT NULL, pkce_verifier TEXT NOT NULL, google_sub TEXT, email TEXT, display_name TEXT, code_hash TEXT, code_salt TEXT, attempts INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0, last_sent_at TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT)",
      "CREATE UNIQUE INDEX IF NOT EXISTS challenges_state ON login_challenges(state_hash)",
      "CREATE INDEX IF NOT EXISTS challenges_expiry ON login_challenges(expires_at)",
      // Hashed email and IP only. A login log that stores raw addresses is a second
      // copy of the user list, which is exactly what an attacker wants from a notes
      // server. Codes are never recorded here.
      "CREATE TABLE IF NOT EXISTS auth_events (id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, email_hash TEXT, ip_hash TEXT, detail TEXT)",
      "CREATE INDEX IF NOT EXISTS auth_events_at ON auth_events(at)",
    ]) {
      await sql.query(statement);
    }
  },
};

/**
 * Page ordering.
 *
 * The sidebar's order used to *be* `created_at` — there was no way to reorder, and
 * a drag that reordered would have survived exactly one render. Dragging a row
 * between two others is only honest if the order is data, so each page gets a
 * `position` scoped to its siblings: two pages with different parents can hold the
 * same number, and only the relative order within one parent means anything.
 *
 * `ADD COLUMN ... NOT NULL DEFAULT 0` is the one alteration both engines accept —
 * the default is what makes NOT NULL legal on a table that already has rows — so
 * this stays inside the "additive only" rule the auth migration set out. Column
 * presence is *not* probed: `PRAGMA table_info` and `information_schema` disagree,
 * and the version row already makes this run once. The guard below exists only for
 * a database that somehow already has the column, so a second run is a no-op
 * rather than a crash.
 *
 * The backfill keeps every existing page exactly where it already was drawn:
 * dense positions per (workspace, parent) in the `created_at, id` order that used
 * to sort them. A migration that visibly reshuffles someone's sidebar would be
 * indistinguishable from a bug.
 */
const pageOrder: Migration = {
  version: 4,
  name: "pages: sibling position, for drag reordering",
  async up(sql) {
    try {
      await sql.query("ALTER TABLE pages ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    } catch (error) {
      // "duplicate column name: position" (SQLite) / 'column "position" of relation
      // "pages" already exists' (Postgres). Anything else is a real failure.
      if (!/duplicate column|already exists/i.test(String((error as Error)?.message ?? error))) throw error;
    }
    /* Grouped in JavaScript rather than SQL: the ordering has to be identical to the
       one the old query used, and `ROW_NUMBER() OVER (PARTITION BY parent_id ...)`
       treats NULL parents as one partition on both engines only by accident. */
    const rows = await sql.query("SELECT id, workspace_id, parent_id FROM pages ORDER BY created_at, id");
    const nextPosition = new Map<string, number>();
    for (const row of rows) {
      const key = `${String(row.workspace_id)}\u0000${row.parent_id === null ? "" : String(row.parent_id)}`;
      const position = nextPosition.get(key) ?? 0;
      nextPosition.set(key, position + 1);
      await sql.query("UPDATE pages SET position=$1 WHERE id=$2", [position, String(row.id)]);
    }
  },
};

/**
 * B26 — media blocks store a URL; this table is what that URL resolves to.
 *
 * `sha256` is the on-disk filename, so the blob is content-addressed and the same
 * photo used on three pages costs one copy. `id` is the uuid that appears in the
 * document, which keeps the reference stable if storage ever moves. Scoping the
 * unique index by workspace means dedupe never crosses accounts.
 */
const fileBlobs: Migration = {
  version: 5,
  name: "files: uploaded media blobs",
  async up(sql) {
    await sql.query(`CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`);
    await sql.query("CREATE UNIQUE INDEX IF NOT EXISTS files_workspace_hash ON files(workspace_id, sha256)");
  },
};

/**
 * B38 — databases.
 *
 * The split from the editor matters more than the columns do. A database's schema,
 * its views and its cell values are **not** page content: if they were, typing a
 * number in a cell would rewrite the whole document, bump `pages.revision` and
 * collide with the draft-conflict machinery, and every sort would mean parsing
 * documents server-side. The `database` block in a page therefore holds only a
 * `databaseId`, and everything below is fetched through its own endpoints.
 *
 * A **row is a page** (`pages.database_id` set), which is what the wishlist asks
 * for with "New page — in the second row of the table": a row gets a body, a
 * revision history, trash, search and links for free. The primary property is
 * `pages.title`, so there is no duplicate copy of the name.
 *
 * `config` and `value` are JSON on purpose: sixteen property types would otherwise
 * mean sixteen migrations, and the property registry validates both on write. One
 * row per (row, property) keeps a cell patch a one-row update and a property delete
 * a one-statement cleanup, which a JSON blob per row could not do without rewriting
 * every row.
 */
const databases: Migration = {
  version: 6,
  name: "databases: schema, views and cells",
  async up(sql) {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS databases (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        page_id TEXT,
        title TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'database',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS databases_workspace ON databases(workspace_id)",
      "CREATE INDEX IF NOT EXISTS databases_page ON databases(page_id)",
      `CREATE TABLE IF NOT EXISTS database_properties (
        id TEXT PRIMARY KEY,
        database_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS database_properties_order ON database_properties(database_id, position)",
      `CREATE TABLE IF NOT EXISTS database_views (
        id TEXT PRIMARY KEY,
        database_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS database_views_order ON database_views(database_id, position)",
      /* Sparse: a missing row is an empty cell, so deleting a property is a delete
         rather than a JSON rewrite of every row. */
      `CREATE TABLE IF NOT EXISTS database_cells (
        row_id TEXT NOT NULL,
        property_id TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (row_id, property_id)
      )`,
      "CREATE INDEX IF NOT EXISTS database_cells_property ON database_cells(property_id)",
    ]) {
      await sql.query(statement);
    }
    /* SQLite refuses a REFERENCES clause on ADD COLUMN unless the default is NULL,
       and the tree queries filter on this column, so it is added bare and indexed. */
    try {
      await sql.query("ALTER TABLE pages ADD COLUMN database_id TEXT");
    } catch (error) {
      if (!/duplicate column|already exists/i.test(String((error as Error)?.message ?? error))) throw error;
    }
    await sql.query("CREATE INDEX IF NOT EXISTS pages_database ON pages(database_id)");
  },
};

/**
 * Property icons, and a name for the primary property.
 * ---------------------------------------------------------------------------
 * `database_properties.icon` holds an icon *name*, not a component: the vocabulary
 * lives in the editor, and a server that has to know what a "check" looks like is a
 * server that breaks when the icon set changes. NULL means "the one this property
 * type ships with", so no column is ever iconless.
 *
 * `databases.title_property` is a small JSON bag for the primary property, which has
 * no row in `database_properties` on purpose — its values are `pages.title`, and a
 * row would be a second copy of the name that can drift. SQLite needs a constant
 * default on ADD COLUMN, so both arrive nullable and are read defensively.
 */
const propertyIcons: Migration = {
  version: 7,
  name: "property-icons",
  async up(sql) {
    for (const statement of [
      "ALTER TABLE database_properties ADD COLUMN icon TEXT",
      "ALTER TABLE databases ADD COLUMN title_property TEXT",
    ]) {
      try {
        await sql.query(statement);
      } catch (error) {
        /* A fresh database runs the baseline DDL first; a migrated one has the
           columns already if this ever gets re-run by hand. */
        if (!/duplicate column|already exists/i.test(String((error as Error)?.message ?? error))) throw error;
      }
    }
  },
};

export const migrations: readonly Migration[] = [baseline, childPageLinks, authSchema, pageOrder, fileBlobs, databases, propertyIcons];

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
