import { randomUUID } from "node:crypto";
import {
  configSchemas,
  createDatabaseSchema,
  createPropertySchema,
  createRowSchema,
  defaultViewConfig,
  patchDatabaseSchema,
  patchPropertySchema,
  patchRowSchema,
  patchViewSchema,
  primaryPropertyId,
  propertyTypeSchema,
  reorderRowsSchema,
  rowMutationSchema,
  titlePropertyMetaSchema,
  titlePropertyWith,
  viewConfigSchema,
  viewTypeSchema,
  type CellValue,
  type DatabasePayload,
  type PropertyDef,
  type PropertyType,
  type RowDef,
  type TitlePropertyMeta,
  type ViewDef,
  type ViewType,
} from "../lib/database/types";
import { resolveProperty, type PropertyTypeSpec } from "../lib/database/properties";
import { convertCell } from "../lib/database/convert";
import { pruneOptionValue } from "../lib/database/property-types/groups";
import type { Database, Sql } from "./database";
import { AppError, access, databaseScope, fingerprint, receipt, remember, type Actor } from "./service";

/**
 * Databases — the server side of B38.
 *
 * Kept beside `RaspberryService` rather than inside it because it is a different
 * aggregate: a page is a document, a database is a schema plus rows that happen to be
 * pages. It reuses the page service's `access`, `fingerprint`, `receipt` and `remember`
 * rather than reimplementing them, so a database write gets the same workspace check
 * and the same replay safety as a page write.
 *
 * Two rules from the plan are enforced here and nowhere else:
 *   • the schema, the views and the cells are *not* page content (see migration 6);
 *   • a row is a page with `database_id` set, and its primary property is `title`.
 */

type Row = Record<string, unknown>;

function text(value: unknown): string { return value === null || value === undefined ? "" : String(value); }

/* Config is JSON written by whatever build was current at the time. Reading it through
   the type's schema and falling back to that type's defaults means a config an older
   build cannot parse degrades to "no settings" instead of making the database
   unopenable — the alternative is a 500 that loses the table because one column had an
   unrecognised key. Unknown keys are merged back in so a newer build's settings survive
   a round trip through this one. */
function readConfig(type: PropertyType, raw: unknown): Record<string, unknown> {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
  } catch { stored = {}; }
  const known = configSchemas[type].safeParse(stored);
  return { ...stored, ...(known.success ? (known.data as Record<string, unknown>) : {}) };
}

function readViewConfig(raw: unknown): ViewDef["config"] {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
  } catch { stored = {}; }
  const known = viewConfigSchema.safeParse(stored);
  return known.success ? known.data : { ...defaultViewConfig };
}

function property(row: Row): PropertyDef {
  const type = propertyTypeSchema.catch("text").parse(row.type) as PropertyType;
  const icon = text(row.icon);
  return {
    id: text(row.id),
    name: text(row.name),
    type,
    config: readConfig(type, row.config),
    position: Number(row.position ?? 0),
    /* Absent rather than "" so the editor's type default applies. */
    ...(icon ? { icon } : {}),
  };
}

/** The primary property's name and icon, as stored on the database row. */
function titleMeta(raw: unknown): TitlePropertyMeta {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
  } catch { stored = {}; }
  const known = titlePropertyMetaSchema.safeParse(stored);
  return known.success ? known.data : {};
}

function view(row: Row): ViewDef {
  const type = viewTypeSchema.catch("table").parse(row.type) as ViewType;
  return { id: text(row.id), name: text(row.name), type, config: readViewConfig(row.config), position: Number(row.position ?? 0) };
}

/* The three types whose values are *ids into the property's config*. Deleting one of
   those ids is a config write that also orphans cells, which is why `patchProperty`
   prunes them — see the note there. */
const optionPropertyTypes = new Set<PropertyType>(["select", "multiSelect", "status"]);

export class DatabaseService {
  constructor(private readonly database: Database) {}

  /* Every database read and write starts here: one row, scoped to the workspace, that
     the rest of the method can trust. Same shape as the page service's `find`. */
  private async load(sql: Sql, actor: Actor, id: string): Promise<Row> {
    const [row] = await sql.query("SELECT * FROM databases WHERE id=$1 AND workspace_id=$2", [id, actor.workspaceId]);
    if (!row) throw new AppError(404, "not_found", "This database is unavailable.");
    return row;
  }

  async create(actor: Actor, input: unknown): Promise<DatabasePayload> {
    const data = createDatabaseSchema.parse(input);
    const hash = fingerprint("database:create", data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, data.mutationId, hash);
      if (replay) return replay;
      if (data.pageId) {
        const [owner] = await sql.query("SELECT id FROM pages WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", [data.pageId, actor.workspaceId]);
        if (!owner) throw new AppError(404, "not_found", "That page is unavailable.");
      }
      const id = randomUUID(), now = new Date().toISOString();
      await sql.query(
        "INSERT INTO databases(id,workspace_id,page_id,title,icon,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, actor.workspaceId, data.pageId, data.title, "database", 1, now, now],
      );
      /* The wishlist's first item is the table view, so a new database opens on one.
         Later views are added beside it as tabs. */
      await sql.query(
        "INSERT INTO database_views(id,database_id,name,type,config,position,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [randomUUID(), id, "Table", "table", JSON.stringify(defaultViewConfig), 0, now],
      );
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, data.mutationId, hash, result);
      return result;
    });
  }

  async get(actor: Actor, id: string): Promise<DatabasePayload> {
    return this.database.transaction(async (sql) => {
      await access(sql, actor);
      return this.read(sql, actor, id);
    });
  }

  async patch(actor: Actor, id: string, input: unknown): Promise<DatabasePayload> {
    const data = patchDatabaseSchema.parse(input);
    const hash = fingerprint(`database:patch:${id}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, data.mutationId, hash);
      if (replay) return replay;
      const row = await this.load(sql, actor, id);
      if (Number(row.revision) !== data.expectedRevision) throw new AppError(409, "revision_conflict", "This database changed. Reload before editing its structure.");
      const now = new Date().toISOString();
      await sql.query(
        "UPDATE databases SET title=$1,icon=$2,revision=revision+1,updated_at=$3 WHERE id=$4",
        [data.title ?? text(row.title), data.icon ?? text(row.icon), now, id],
      );
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, data.mutationId, hash, result);
      return result;
    });
  }

  /* ---------------------------------------------------------------------------
     Properties
     ---------------------------------------------------------------------------
     A property is schema. Adding, renaming, reconfiguring or removing one bumps
     `databases.revision`, which is what the block header's rename negotiates over:
     a tab holding a schema that no longer exists gets a 409 instead of writing a
     property id the server has never heard of.

     Cell *values* do not bump it. Typing in a table is not a structural edit, and
     a revision conflict on a keystroke would be a reload per character.
     --------------------------------------------------------------------------- */

  async addProperty(actor: Actor, id: string, input: unknown): Promise<DatabasePayload> {
    const data = createPropertySchema.parse(input);
    const hash = fingerprint(`database:property:create:${id}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, data.mutationId, hash);
      if (replay) return replay;
      await this.load(sql, actor, id);
      /* The type's own schema validates the config, not the caller's optimism: a
         property row that cannot be parsed back is a column that cannot render,
         and it would fail on every read afterwards rather than once here. */
      const config = configSchemas[data.type].safeParse(data.config ?? {});
      if (!config.success) throw new AppError(400, "invalid_config", "These settings do not fit that property type.");
      const [top] = await sql.query("SELECT MAX(position) AS top FROM database_properties WHERE database_id=$1", [id]);
      const now = new Date().toISOString();
      await sql.query(
        "INSERT INTO database_properties(id,database_id,name,type,config,position,created_at,icon) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [randomUUID(), id, data.name, data.type, JSON.stringify(config.data), Number(top?.top ?? -1) + 1, now, data.icon ?? null],
      );
      await sql.query("UPDATE databases SET revision=revision+1,updated_at=$1 WHERE id=$2", [now, id]);
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, data.mutationId, hash, result);
      return result;
    });
  }

  async patchProperty(actor: Actor, id: string, propertyId: string, input: unknown): Promise<DatabasePayload> {
    const data = patchPropertySchema.parse(input);
    const hash = fingerprint(`database:property:patch:${id}:${propertyId}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, data.mutationId, hash);
      if (replay) return replay;
      await this.load(sql, actor, id);
      const now = new Date().toISOString();
      /* The primary property is not a row in `database_properties` — its values are
         `pages.title`. Renaming it to "Task" and giving it an icon therefore writes to
         the database, not to a property row, which is why the same menu can drive every
         column without the client knowing which one is special. Type stays text: a
         title column that became a number would have nowhere to put a row's name. */
      if (propertyId === primaryPropertyId) {
        if (data.type && data.type !== "text") throw new AppError(400, "primary_property_is_text", "The primary property is always text.");
        const [record] = await sql.query("SELECT title_property FROM databases WHERE id=$1", [id]);
        const existing = titleMeta(record?.title_property);
        const next: TitlePropertyMeta = {
          name: data.name ?? existing.name,
          icon: data.icon ?? existing.icon,
        };
        await sql.query("UPDATE databases SET title_property=$1,revision=revision+1,updated_at=$2 WHERE id=$3", [JSON.stringify(next), now, id]);
        const result = await this.read(sql, actor, id);
        await remember(sql, actor, data.mutationId, hash, result);
        return result;
      }
      const [row] = await sql.query("SELECT * FROM database_properties WHERE id=$1 AND database_id=$2", [propertyId, id]);
      if (!row) throw new AppError(404, "not_found", "That property is unavailable.");
      const before = property(row);
      const nextType = data.type ?? before.type;
      const config = { value: readConfig(nextType, row.config) };
      if (data.config !== undefined) {
        const parsed = configSchemas[nextType].safeParse(data.config);
        if (!parsed.success) throw new AppError(400, "invalid_config", "These settings do not fit that property type.");
        config.value = parsed.data as Record<string, unknown>;
      }
      /* Re-typing a column reinterprets the values already in it — it does not throw
         them away, and it does not keep them under a type that can no longer read them.
         Every stored value is read through the *new* type (see `convert.ts`); values it
         can read are rewritten in the new shape, values it cannot are counted.
         With unreadable values present the change is refused, because a table that
         loses data on a menu click is worse than a menu item that says how many cells
         it would clear. `clearUnconvertible` is the caller saying "I mean it" — the
         count comes back as `details`, so the client can offer exactly that sentence
         instead of a number the person has to guess at. */
      if (data.type && data.type !== before.type) {
        const cells = await sql.query("SELECT row_id,value FROM database_cells WHERE property_id=$1 AND value IS NOT NULL", [propertyId]);
        const kept: { rowId: string; value: CellValue }[] = [];
        let unreadable = 0;
        for (const cell of cells) {
          let stored: CellValue = null;
          try { stored = JSON.parse(text(cell.value)) as CellValue; } catch { /* a corrupt cell reads as empty, as it does in `rows()` */ }
          const converted = convertCell(before, stored, nextType, config.value);
          if (!converted.ok) unreadable += 1;
          else kept.push({ rowId: text(cell.row_id), value: converted.value });
        }
        if (unreadable > 0 && !data.clearUnconvertible) {
          throw new AppError(
            409,
            "property_in_use",
            `${unreadable} ${unreadable === 1 ? "cell holds a value" : "cells hold values"} that ${nextType} cannot read. Change the type anyway to clear ${unreadable === 1 ? "it" : "them"}.`,
            { propertyId, cells: unreadable, type: nextType },
          );
        }
        await sql.query("DELETE FROM database_cells WHERE property_id=$1", [propertyId]);
        for (const cell of kept) {
          if (cell.value === null) continue;
          await sql.query(
            "INSERT INTO database_cells(row_id,property_id,value,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(row_id,property_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            [cell.rowId, propertyId, JSON.stringify(cell.value), now],
          );
        }
      }
      await sql.query(
        "UPDATE database_properties SET name=$1,type=$2,config=$3,icon=$4 WHERE id=$5",
        [data.name ?? text(row.name), nextType, JSON.stringify(config.value), data.icon !== undefined ? data.icon || null : text(row.icon) || null, propertyId],
      );
      /* A tag lives in the property's config, so deleting one — or deleting a whole
         status group, which takes its tags with it — is a config write, and every cell
         that stored one of those ids is now pointing at nothing. Prune them here, in the
         same transaction: the owner asked for exactly this ("any cell using them is
         cleared"), and a deleted tag that keeps rendering in a cell is a row that no
         longer says anything true. A cell with nothing left is deleted, which is how
         every other empty value is stored. */
      if (data.config !== undefined && optionPropertyTypes.has(nextType)) {
        const surviving = new Set(
          ((config.value.options as { id?: unknown }[] | undefined) ?? [])
            .map((option) => (typeof option?.id === "string" ? option.id : ""))
            .filter((optionId) => optionId !== ""),
        );
        const cells = await sql.query("SELECT row_id,value FROM database_cells WHERE property_id=$1 AND value IS NOT NULL", [propertyId]);
        for (const cell of cells) {
          let stored: CellValue = null;
          try { stored = JSON.parse(text(cell.value)) as CellValue; } catch { continue; }
          const pruned = pruneOptionValue(stored, surviving);
          if (pruned === stored) continue;
          const rowId = text(cell.row_id);
          if (pruned === null) await sql.query("DELETE FROM database_cells WHERE row_id=$1 AND property_id=$2", [rowId, propertyId]);
          else await sql.query("UPDATE database_cells SET value=$1,updated_at=$2 WHERE row_id=$3 AND property_id=$4", [JSON.stringify(pruned), now, rowId, propertyId]);
        }
      }
      await sql.query("UPDATE databases SET revision=revision+1,updated_at=$1 WHERE id=$2", [now, id]);
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, data.mutationId, hash, result);
      return result;
    });
  }

  /* ---------------------------------------------------------------------------
     Views
     ---------------------------------------------------------------------------
     A view's config is everything a person tunes about *presentation*: column
     widths, sorts, filters, grouping, row height. It is per view and it does **not**
     bump `databases.revision`, for the same reason a cell edit does not — dragging a
     column wider is not a schema change, and bumping would make another tab's next
     structural write look like a conflict it has to resolve.
     --------------------------------------------------------------------------- */

  async patchView(actor: Actor, id: string, viewId: string, input: unknown): Promise<DatabasePayload> {
    const data = patchViewSchema.parse(input);
    const hash = fingerprint(`database:view:patch:${id}:${viewId}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, data.mutationId, hash);
      if (replay) return replay;
      await this.load(sql, actor, id);
      const [row] = await sql.query("SELECT * FROM database_views WHERE id=$1 AND database_id=$2", [viewId, id]);
      if (!row) throw new AppError(404, "not_found", "That view is unavailable.");
      /* Merged, not replaced. The client sends only what changed — one width, one
         sort — so two adjustments made in quick succession cannot erase each other.
         The merged result is validated as a whole, so a bad width cannot land in
         storage and fail on every read afterwards. */
      const previous = readViewConfig(row.config);
      const config = data.config === undefined
        ? previous
        : viewConfigSchema.parse({ ...previous, ...(data.config as Record<string, unknown>) });
      await sql.query("UPDATE database_views SET name=$1,config=$2 WHERE id=$3", [data.name ?? text(row.name), JSON.stringify(config), viewId]);
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, data.mutationId, hash, result);
      return result;
    });
  }

  async deleteProperty(actor: Actor, id: string, propertyId: string, mutationId: string): Promise<DatabasePayload> {
    const hash = fingerprint(`database:property:delete:${id}:${propertyId}`, { mutationId });
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, mutationId, hash);
      if (replay) return replay;
      await this.load(sql, actor, id);
      const [row] = await sql.query("SELECT id FROM database_properties WHERE id=$1 AND database_id=$2", [propertyId, id]);
      if (!row) throw new AppError(404, "not_found", "That property is unavailable.");
      /* Cells first, in the same transaction, or the column's values would outlive
         the column and resurrect if a new property ever took its id. */
      await sql.query("DELETE FROM database_cells WHERE property_id=$1", [propertyId]);
      await sql.query("DELETE FROM database_properties WHERE id=$1", [propertyId]);
      const now = new Date().toISOString();
      await sql.query("UPDATE databases SET revision=revision+1,updated_at=$1 WHERE id=$2", [now, id]);
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, mutationId, hash, result);
      return result;
    });
  }

  /* ---------------------------------------------------------------------------
     Rows and cells
     --------------------------------------------------------------------------- */

  async addRow(actor: Actor, id: string, input: unknown): Promise<DatabasePayload> {
    const data = createRowSchema.parse(input);
    const hash = fingerprint(`database:row:create:${id}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, data.mutationId, hash);
      if (replay) return replay;
      await this.load(sql, actor, id);
      const position = data.after ? await this.slotAfter(sql, id, data.after) : await this.slotAtEnd(sql, id);
      const now = new Date().toISOString();
      /* A row *is* a page: same table, `database_id` set, an empty document body. It
         inherits trash, search, links and revision history for free. */
      await sql.query(
        "INSERT INTO pages(id,workspace_id,parent_id,title,icon,content,plain_text,created_at,updated_at,position,database_id) VALUES($1,$2,NULL,$3,$4,$5,$6,$7,$7,$8,$9)",
        [randomUUID(), actor.workspaceId, data.title, "file", "[]", "", now, position, id],
      );
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, data.mutationId, hash, result);
      return result;
    });
  }

  /* Where a new page goes, when it goes below another one.
     ---------------------------------------------------------------------------
     `after` cannot be arithmetic on the anchor row's `position`.

     Positions here are not contiguous: rows created before this field existed all sit
     at `MAX+1`, and a reordered list only becomes 0..n-1 when something renumbers it.
     `after.position + 1` would therefore collide with a sibling and the new page would
     land in whichever slot `created_at` broke the tie in. Renumbering to 0..n-1 first is
     what makes the gap real. */
  private async slotAfter(sql: Sql, id: string, after: string): Promise<number> {
    const ordered = (await sql.query("SELECT id FROM pages WHERE database_id=$1 AND deleted_at IS NULL ORDER BY position,created_at,id", [id])).map((row) => text(row.id));
    const at = ordered.indexOf(after);
    if (at < 0) throw new AppError(404, "not_found", "That row is unavailable.");
    for (const [index, rowId] of ordered.entries()) {
      await sql.query("UPDATE pages SET position=$1 WHERE id=$2", [index, rowId]);
    }
    await sql.query("UPDATE pages SET position=position+1 WHERE database_id=$1 AND deleted_at IS NULL AND position>$2", [id, at]);
    return at + 1;
  }

  private async slotAtEnd(sql: Sql, id: string): Promise<number> {
    const [top] = await sql.query("SELECT MAX(position) AS top FROM pages WHERE database_id=$1 AND deleted_at IS NULL", [id]);
    return Number(top?.top ?? -1) + 1;
  }

  /** One live entry of *this* database, or a 404. The `database_id` in the WHERE clause
   *  is the whole point: a row id from another database must not be writable through
   *  this URL. */
  private async rowOf(sql: Sql, id: string, rowId: string): Promise<Row> {
    const [row] = await sql.query("SELECT * FROM pages WHERE id=$1 AND database_id=$2 AND deleted_at IS NULL", [rowId, id]);
    if (!row) throw new AppError(404, "not_found", "That entry is unavailable.");
    return row;
  }

  /* Duplicating an entry.
     ---------------------------------------------------------------------------
     A copy is the same entry: same title, same icon, same body, same cell values, in the
     slot directly below the original. Its own page id and its own cells — cells are
     keyed by `row_id`, so they cannot be shared.

     The copy is *not* renamed. The object menu's "Duplicate" on a block produces "copy"
     text because a block has no name; an entry does, and a table with three rows called
     "Task copy copy" is worse than a table with two rows called "Task" that the person
     renames one of. */
  async duplicateRow(actor: Actor, id: string, rowId: string, input: unknown): Promise<DatabasePayload> {
    const data = rowMutationSchema.parse(input);
    const hash = fingerprint(`database:row:duplicate:${id}:${rowId}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, data.mutationId, hash);
      if (replay) return replay;
      await this.load(sql, actor, id);
      const source = await this.rowOf(sql, id, rowId);
      const position = await this.slotAfter(sql, id, rowId);
      const copyId = randomUUID();
      const now = new Date().toISOString();
      await sql.query(
        "INSERT INTO pages(id,workspace_id,parent_id,title,icon,content,plain_text,created_at,updated_at,position,database_id) VALUES($1,$2,NULL,$3,$4,$5,$6,$7,$7,$8,$9)",
        [copyId, actor.workspaceId, text(source.title), text(source.icon), text(source.content), text(source.plain_text), now, position, id],
      );
      await sql.query("INSERT INTO database_cells(row_id,property_id,value,updated_at) SELECT $1,property_id,value,$3 FROM database_cells WHERE row_id=$2", [copyId, rowId, now]);
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, data.mutationId, hash, result);
      return result;
    });
  }

  /* Moving an entry to trash.
     ---------------------------------------------------------------------------
     A soft delete, and the same one the page service does: `deleted_at` plus a batch id
     shared by everything the action touched, so Trash can restore it as one thing. The
     page, its body and its cells all survive — restore puts the entry back with its
     values, which a hard delete could not.

     A row's `parent_id` is NULL, so the recursive tree here is usually just the row
     itself; it is recursive anyway because a person *can* file a page under an entry,
     and trashing an entry that leaves two orphaned children visible in the sidebar
     would be a bug nobody would attribute to this line of code. `databaseScope` covers
     the other case: a database block *inside* an entry's body has rows of its own, and
     those are not in the parent/child tree. */
  async trashRow(actor: Actor, id: string, rowId: string, input: unknown): Promise<DatabasePayload> {
    const data = rowMutationSchema.parse(input);
    const hash = fingerprint(`database:row:trash:${id}:${rowId}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, data.mutationId, hash);
      if (replay) return replay;
      await this.load(sql, actor, id);
      await this.rowOf(sql, id, rowId);
      const tree = (await sql.query("WITH RECURSIVE tree AS (SELECT id FROM pages WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT p.id FROM pages p JOIN tree t ON p.parent_id=t.id WHERE p.workspace_id=$2) SELECT id FROM tree", [rowId, actor.workspaceId])).map((item) => String(item.id));
      const scope = await databaseScope(sql, tree);
      const ids = [...new Set([...tree, ...scope.rowIds])];
      const now = new Date().toISOString();
      const batch = randomUUID();
      const slots = ids.map((_, index) => `$${index + 3}`).join(",");
      await sql.query(`UPDATE pages SET deleted_at=$1, trash_batch=$2 WHERE workspace_id=$${ids.length + 3} AND deleted_at IS NULL AND id IN (${slots})`, [now, batch, ...ids, actor.workspaceId]);
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, data.mutationId, hash, result);
      return result;
    });
  }

  /* Dragging a row by its grip.
     ---------------------------------------------------------------------------
     `ids` may name every live row or only some of them — a table can be filtered or
     windowed, and the caller should not have to know which rows it cannot see. Rows
     named in neither keep their relative order and follow the named ones, so the
     result is a total order in every case. */
  async reorderRows(actor: Actor, id: string, input: unknown): Promise<DatabasePayload> {
    const data = reorderRowsSchema.parse(input);
    const hash = fingerprint(`database:row:order:${id}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, data.mutationId, hash);
      if (replay) return replay;
      await this.load(sql, actor, id);
      /* A repeated id would make the requested order ambiguous, which is a row that
         silently jumps from somewhere the caller never named. That is a caller bug,
         and a 400 is how it hears about it. */
      if (new Set(data.ids).size !== data.ids.length) throw new AppError(400, "invalid_request", "A row can only appear once in an order.");
      const ordered = (await sql.query("SELECT id FROM pages WHERE database_id=$1 AND deleted_at IS NULL ORDER BY position,created_at,id", [id])).map((row) => text(row.id));
      const live = new Set(ordered);
      for (const rowId of data.ids) {
        if (!live.has(rowId)) throw new AppError(404, "not_found", "That row is unavailable.");
      }
      const named = new Set(data.ids);
      const next = [...data.ids, ...ordered.filter((rowId) => !named.has(rowId))];
      for (const [index, rowId] of next.entries()) {
        await sql.query("UPDATE pages SET position=$1 WHERE id=$2", [index, rowId]);
      }
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, data.mutationId, hash, result);
      return result;
    });
  }

  async patchRow(actor: Actor, id: string, rowId: string, input: unknown): Promise<DatabasePayload> {
    const data = patchRowSchema.parse(input);
    const hash = fingerprint(`database:row:patch:${id}:${rowId}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const replay = await receipt<DatabasePayload>(sql, actor, data.mutationId, hash);
      if (replay) return replay;
      await this.load(sql, actor, id);
      const [row] = await sql.query("SELECT id FROM pages WHERE id=$1 AND database_id=$2 AND deleted_at IS NULL", [rowId, id]);
      if (!row) throw new AppError(404, "not_found", "That row is unavailable.");
      const now = new Date().toISOString();
      if (data.icon !== undefined) {
        /* No `revision` bump: an icon is presentation, and making it bump would force
           every open draft of this entry's body to reload for a glyph. */
        await sql.query("UPDATE pages SET icon=$1,updated_at=$2 WHERE id=$3", [data.icon, now, rowId]);
      }
      if (data.title !== undefined) {
        /* `revision` goes up so an open draft of the row's body cannot save over the
           rename with the title it loaded, which is the same guarantee the page
           editor gives itself. */
        await sql.query("UPDATE pages SET title=$1,updated_at=$2,revision=revision+1 WHERE id=$3", [data.title, now, rowId]);
      }
      for (const [propertyId, raw] of Object.entries(data.cells ?? {})) {
        const [prop] = await sql.query("SELECT type,config FROM database_properties WHERE id=$1 AND database_id=$2", [propertyId, id]);
        if (!prop) throw new AppError(404, "not_found", "That property is unavailable.");
        const def = property(prop as Row);
        const spec = resolveProperty(def) as PropertyTypeSpec;
        /* `readOnly` and `derived` are promises the type modules already make —
           `created-time` says "nobody can claim it was created at a time it was not",
           `button` says "the write path refuses a value rather", `formula` says "there
           is no `database_cells` row". Until this guard existed none of that was true:
           the write path coerced and stored whatever it was given, so a formula column
           could be typed into and would then display the typed value as if the
           expression had produced it. Refusing here — loudly, before any write — is
           what makes those three comments honest. It is checked per cell rather than on
           the request because one request can carry writable and unwritable columns. */
        if (spec.derived) {
          throw new AppError(400, "property_is_computed", `"${def.name}" is computed from other properties and cannot be edited.`);
        }
        if (spec.readOnly) {
          throw new AppError(400, "property_is_read_only", `"${def.name}" is set by Raspberry and cannot be edited.`);
        }
        /* The value is normalised by the property's own `coerce` — the same function
           the editor and the tests use — so "1 234,50" and 1234.5 cannot both end up
           stored in a number column. Empty becomes *no row*, one representation of
           "nothing" for sorts, filters and exports to agree on. */
        const value = spec.coerce(raw, def.config);
        if (value === null) await sql.query("DELETE FROM database_cells WHERE row_id=$1 AND property_id=$2", [rowId, propertyId]);
        else {
          await sql.query(
            "INSERT INTO database_cells(row_id,property_id,value,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(row_id,property_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            [rowId, propertyId, JSON.stringify(value), now],
          );
        }
      }
      await sql.query("UPDATE databases SET updated_at=$1 WHERE id=$2", [now, id]);
      const result = await this.read(sql, actor, id);
      await remember(sql, actor, data.mutationId, hash, result);
      return result;
    });
  }

  /* Reads the whole aggregate: the database, its properties, its views and its rows
     with their cells. One transaction, so a table can never render a property it has
     no values for. At personal scale this is a handful of queries over a few hundred
     rows; the row-set pipeline narrows and windows it client-side, which is what keeps
     every future view consistent. */
  private async read(sql: Sql, actor: Actor, id: string): Promise<DatabasePayload> {
    const row = await this.load(sql, actor, id);
    const properties = (await sql.query("SELECT * FROM database_properties WHERE database_id=$1 ORDER BY position,created_at,id", [id])).map(property);
    const views = (await sql.query("SELECT * FROM database_views WHERE database_id=$1 ORDER BY position,created_at,id", [id])).map(view);
    const rows = await this.rows(sql, id);
    return {
      id: text(row.id),
      pageId: row.page_id ? text(row.page_id) : null,
      title: text(row.title),
      icon: text(row.icon) || "database",
      revision: Number(row.revision ?? 1),
      titleProperty: titlePropertyWith(titleMeta(row.title_property)),
      properties,
      views: views.length ? views : [{
        id: "", name: "Table", type: "table", position: 0, config: { ...defaultViewConfig },
      }],
      rows,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
  }

  /* Rows are pages. `deleted_at IS NULL` keeps a trashed row out of its own table while
     it sits in the trash, which is the same rule the sidebar follows. */
  private async rows(sql: Sql, databaseId: string): Promise<RowDef[]> {
    const pages = await sql.query(
      "SELECT id,title,icon,position,created_at,updated_at FROM pages WHERE database_id=$1 AND deleted_at IS NULL ORDER BY position,created_at,id",
      [databaseId],
    );
    if (!pages.length) return [];
    /* Joined back through pages rather than collecting ids into an IN list: the list
       would have to be built with one placeholder per row. */
    const cells = await sql.query(
      "SELECT c.row_id,c.property_id,c.value FROM database_cells c JOIN pages p ON p.id=c.row_id WHERE p.database_id=$1",
      [databaseId],
    );
    const byRow = new Map<string, Record<string, CellValue>>();
    for (const cell of cells) {
      const rowId = text(cell.row_id);
      const bucket = byRow.get(rowId) ?? {};
      try { bucket[text(cell.property_id)] = JSON.parse(text(cell.value)) as CellValue; } catch { /* a corrupt cell reads as empty */ }
      byRow.set(rowId, bucket);
    }
    return pages.map((item) => ({
      id: text(item.id),
      title: text(item.title),
      icon: text(item.icon),
      cells: byRow.get(text(item.id)) ?? {},
      createdAt: text(item.created_at),
      updatedAt: text(item.updated_at),
      position: Number(item.position ?? 0),
    }));
  }
}
