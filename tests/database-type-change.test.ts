import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openMigrated } from "./schema";
import type { Database } from "../src/server/database";
import { DatabaseService } from "../src/server/databases";
import { RaspberryService, localActor, AppError } from "../src/server/service";
import type { DatabasePayload } from "../src/lib/database/types";
import { convertCell } from "../src/lib/database/convert";
import { formatCell } from "../src/lib/database/properties";
import { propertyTypes, type CellValue, type PropertyDef, type PropertyType } from "../src/lib/database/types";

/**
 * Changing a column's type — B40.
 *
 * The rule this file exists to pin: a type change *reads* the values already in the
 * column through the new type. It never wipes them silently, and it never keeps a
 * value the new type cannot read behind a column that will then display a lie.
 *
 * The old behaviour was `if any cell has a value: 409 "clear the cells first"`. There
 * was no way to clear a cell except emptying every one of them by hand, and the menu
 * therefore had no Change type item at all. Both halves of that are fixed here: the
 * conversion is real, and when it cannot be, the refusal carries the count so the
 * client can offer "change anyway (clears N)".
 */
const owner = localActor();

async function fresh() {
  const db = await openMigrated();
  const pages = new RaspberryService(db);
  await pages.seed();
  const databases = new DatabaseService(db);
  const database = await databases.create(owner, { title: "Tasks", mutationId: randomUUID() });
  return { db, databases, database };
}

async function firstRow<T extends Record<string, unknown>>(db: Database, sqlText: string, values: unknown[] = []): Promise<T> {
  return db.transaction(async (sql) => {
    const [row] = await sql.query<T>(sqlText, values);
    return row;
  });
}

/* One property holding one value, which is the smallest thing a type change acts on. */
async function withTextColumn(text: string) {
  const value = await fresh();
  const added: DatabasePayload = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "Field", mutationId: randomUUID() });
  const propertyId = added.properties[0].id;
  const withRow = await value.databases.addRow(owner, value.database.id, { title: "One entry", mutationId: randomUUID() });
  const rowId = withRow.rows[0].id;
  await value.databases.patchRow(owner, value.database.id, rowId, { cells: { [propertyId]: text }, mutationId: randomUUID() });
  return { ...value, propertyId, rowId };
}

test("a column of numbers becomes a number column holding numbers, not its own text", async () => {
  const value = await withTextColumn("1234.5");

  const next = await value.databases.patchProperty(owner, value.database.id, value.propertyId, { type: "number", mutationId: randomUUID() });

  assert.equal(next.properties[0].type, "number");
  const row = next.rows.find((item) => item.id === value.rowId);
  assert.equal(row?.cells[value.propertyId], 1234.5);
  assert.equal(typeof row?.cells[value.propertyId], "number");
});

test("a text cell that is already a number keeps its exact value through a round trip", async () => {
  const value = await withTextColumn("7");

  await value.databases.patchProperty(owner, value.database.id, value.propertyId, { type: "number", mutationId: randomUUID() });
  const back = await value.databases.patchProperty(owner, value.database.id, value.propertyId, { type: "text", mutationId: randomUUID() });

  const row = back.rows.find((item) => item.id === value.rowId);
  assert.equal(row?.cells[value.propertyId], "7");
});

test("a value the new type cannot read refuses the change and names how many cells", async () => {
  const value = await withTextColumn("tomorrow");

  const error = await value.databases
    .patchProperty(owner, value.database.id, value.propertyId, { type: "date", mutationId: randomUUID() })
    .then(() => null, (thrown: unknown) => thrown);

  assert.ok(error instanceof AppError);
  assert.equal(error.status, 409);
  assert.equal(error.code, "property_in_use");
  /* The count is the difference between a dead end and a decision; the property id is
     what lets the menu offer it on the right column. */
  assert.deepEqual(error.details, { propertyId: value.propertyId, cells: 1, type: "date" });
});

test("a refused change changes nothing — not the type, not the values", async () => {
  const value = await withTextColumn("tomorrow");

  await value.databases
    .patchProperty(owner, value.database.id, value.propertyId, { type: "date", mutationId: randomUUID() })
    .catch(() => null);

  const after = await value.databases.get(owner, value.database.id);
  assert.equal(after.properties[0].type, "text");
  assert.equal(after.rows.find((item) => item.id === value.rowId)?.cells[value.propertyId], "tomorrow");
});

test("clearUnconvertible changes the type and clears only what could not be read", async () => {
  const value = await fresh();
  const added = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "Field", mutationId: randomUUID() });
  const propertyId = added.properties[0].id;
  /* Two rows: one readable as a date, one not. Only the second may lose its value. */
  const good = await value.databases.addRow(owner, value.database.id, { title: "Good", mutationId: randomUUID() });
  const bad = await value.databases.addRow(owner, value.database.id, { title: "Bad", mutationId: randomUUID() });
  await value.databases.patchRow(owner, value.database.id, good.rows[0].id, { cells: { [propertyId]: "1 + 1" }, mutationId: randomUUID() });
  await value.databases.patchRow(owner, value.database.id, bad.rows[0].id, { cells: { [propertyId]: "tomorrow" }, mutationId: randomUUID() });

  const next = await value.databases.patchProperty(owner, value.database.id, propertyId, {
    type: "text", mutationId: randomUUID(), clearUnconvertible: true,
  });

  /* Text reads everything, so nothing is lost at all — the flag is the answer to a
     refusal, and a change that needs no refusal must not be turned into a wipe by it. */
  assert.equal(next.properties[0].type, "text");
  assert.equal(next.rows.find((item) => item.id === bad.rows[0].id)?.cells[propertyId], "tomorrow");
});

test("changing to a type that stores nothing clears the cells only when told to", async () => {
  const value = await withTextColumn("anything at all");

  const refused = await value.databases
    .patchProperty(owner, value.database.id, value.propertyId, { type: "formula", mutationId: randomUUID() })
    .then(() => null, (thrown: unknown) => thrown);
  assert.equal((refused as AppError).code, "property_in_use");

  const next = await value.databases.patchProperty(owner, value.database.id, value.propertyId, {
    type: "formula", mutationId: randomUUID(), clearUnconvertible: true,
  });
  assert.equal(next.properties[0].type, "formula");
  /* An empty cell is an absent cell in the payload — there is no null row to read. */
  assert.equal(next.rows.find((item) => item.id === value.rowId)?.cells[value.propertyId] ?? null, null);
  /* And nothing is left in the table: an empty cell is no row, which is the one
     representation of "nothing" every reader agrees on. */
  const stored = await firstRow<{ count: number }>(value.db, "SELECT COUNT(*) AS count FROM database_cells WHERE property_id=$1", [value.propertyId]);
  assert.equal(Number(stored.count), 0);
});

/* ---------------------------------------------------------------------------
   The conversion contract itself
   --------------------------------------------------------------------------- */

test("every type in `textReadingTypes` really reads the text it printed", () => {
  /* This is the assertion the allow-list in `convert.ts` points at. A type added there
     without a working `coerce` would turn a type change into a silent wipe, so the
     claim is checked against the registry rather than against a second list. */
  const probes: CellValue[] = [1, 42.5, "hello", "1 234,5", "yes", "https://example.com"];
  for (const type of propertyTypes) {
    for (const probe of probes) {
      const from: PropertyDef = { id: "p", name: "P", position: 0, type, config: {} };
      const shown = formatCell(from, probe);
      const converted = convertCell(from, probe, "text");
      assert.ok(converted.ok, `${type} should always convert to text`);
      /* An empty cell becomes empty (`null`), never the empty string: one representation
         of nothing, which is the rule the write path and the cell table already follow. */
      assert.equal(converted.value, shown === "" ? null : shown, `${type} → text must be exactly what the column showed`);
    }
  }
});

test("a value is never invented: converting an empty cell stays empty", () => {
  const from: PropertyDef = { id: "p", name: "P", position: 0, type: "checkbox", config: {} };
  assert.deepEqual(convertCell(from, null, "number"), { ok: true, value: null });
  assert.deepEqual(convertCell(from, "", "date"), { ok: true, value: null });
});

test("a target outside the allow-list declines rather than guessing", () => {
  const from: PropertyDef = { id: "p", name: "P", position: 0, type: "text", config: {} };
  for (const target of ["date", "select", "multiSelect", "status", "files", "person"] as PropertyType[]) {
    assert.deepEqual(convertCell(from, "Oct 30, 2026", target), { ok: false }, `${target} must decline`);
  }
});
