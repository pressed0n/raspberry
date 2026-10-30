import { formatCell, resolveProperty } from "./properties";
import {
  primaryPropertyId,
  titleProperty,
  type CellValue,
  type DatabasePayload,
  type FilterOperator,
  type PropertyDef,
  type RowDef,
  type ViewConfig,
} from "./types";

/**
 * The row-set pipeline.
 * ---------------------------------------------------------------------------
 * `load → filter → sort → group → window` — and **every** view consumes the output.
 *
 * Notion's messiest class of bug is two views disagreeing about what "sorted by due
 * date" means, because each view re-derived its own data. Here there is one pipeline,
 * so the table today and the board and calendar later cannot drift: they are
 * renderers over this result, not owners of their own query.
 *
 * Evaluation is in JavaScript rather than SQL. Two reasons: the repo runs on both
 * SQLite and Postgres, and `json_extract` vs `->` is a dialect fork in every sort;
 * and filters, groups and formulas all need the property registry's comparators
 * anyway, which SQL does not have. At personal scale — thousands of rows, a page
 * window of fifty — this is comfortably fast, and `window()` exists so the day it
 * stops being fast the answer is a parameter rather than a redesign.
 */

/* A view reads the schema, not the whole payload: the properties, plus — when the
   database has renamed its primary property — that name and icon. Optional so every
   existing `{ properties }` fixture keeps type-checking. */
export type DatabaseSchema = Pick<DatabasePayload, "properties"> & Partial<Pick<DatabasePayload, "titleProperty">>;

/** The primary property, wearing this database's chosen name and icon. */
export function titlePropertyOf(database: Partial<Pick<DatabasePayload, "titleProperty">>): PropertyDef {
  return database.titleProperty ?? titleProperty;
}

/* Look a property up by id, treating the reserved primary id as the title column so
   a view can sort and filter by Name like any other property. */
export function propertyById(database: DatabaseSchema, id: string): PropertyDef {
  if (id === primaryPropertyId) return titlePropertyOf(database);
  return database.properties.find((item) => item.id === id) ?? { id, name: "Unknown", type: "text", config: {}, position: 0 };
}

export function cellOf(row: RowDef, property: PropertyDef): CellValue {
  if (property.id === primaryPropertyId) return row.title;
  return row.cells[property.id] ?? null;
}

const asOperand = (value: CellValue): unknown => value;

export function matches(database: DatabaseSchema, row: RowDef, filters: ViewConfig["filters"]): boolean {
  /* Every filter must pass: filters are a conjunction in Notion too, and an empty
     list passes everything, which is what makes `filters: []` the default. */
  return filters.every((filter) => {
    const property = propertyById(database, filter.propertyId);
    const value = cellOf(row, property);
    const isEmpty = formatCell(property, value) === "";
    if (filter.operator === "isEmpty") return isEmpty;
    if (filter.operator === "isNotEmpty") return !isEmpty;
    return resolveProperty(property).fits(filter.operator as FilterOperator, value, asOperand(filter.value), (property.config ?? {}) as Record<string, unknown>);
  });
}

/* A sort on a column is a *toggle on that column*, not a replacement of everything else.
   Sorting by Status and then by Name is two clicks, and `selectRows` has always applied a
   list of keys — the UI was the only thing that could not produce a second one, because it
   wrote `sorts: [oneKey]`. Order of the list is order of precedence, so the first column a
   person sorts by stays primary and the next one only breaks its ties.

   Pure and exported so it can be tested without a browser: the block's `sortProperty`
   is one line that calls this, and the interesting part is the array, not the click. */
export function nextSorts(
  sorts: ViewConfig["sorts"],
  propertyId: string,
  direction: "ascending" | "descending" | null,
): ViewConfig["sorts"] {
  if (!direction) return sorts.filter((sort) => sort.propertyId !== propertyId);
  const index = sorts.findIndex((sort) => sort.propertyId === propertyId);
  /* Flipping a column from A → Z to Z → A must not demote it to the last tie-break: the
     key keeps its slot, only its direction changes. A new column is appended, because the
     column you sorted by first is the one you are still sorting by. */
  if (index === -1) return [...sorts, { propertyId, direction }];
  const next = [...sorts];
  next[index] = { propertyId, direction };
  return next;
}

/**
 * Sorts are applied as a chain of comparators, first one wins, with the row's own
 * position as the final tie-break. That last part is what keeps two rows with equal
 * keys from swapping places between renders — a table that reshuffles itself on
 * every load looks broken even when the order is technically valid.
 *
 * Emptiness is decided *before* the direction is applied, and that ordering is the
 * whole reason this function exists in the shape it does. Every `compare` in the
 * registry ends with `compareNullable` and documents the same rule — "empties last" —
 * but negating a comparator to reverse it also reverses that rule, so `Z → A` used to
 * float every empty row to the top. A person sorting descending is asking for the
 * largest values first, not for their blank rows. Comparing emptiness separately and
 * returning early keeps the promise direction-independent.
 */
export function sortRows(database: DatabaseSchema, rows: RowDef[], sorts: ViewConfig["sorts"]): RowDef[] {
  if (!sorts.length) return rows;
  const keys = sorts.map((sort) => {
    const property = propertyById(database, sort.propertyId);
    return {
      property,
      spec: resolveProperty(property),
      config: (property.config ?? {}) as Record<string, unknown>,
      descending: sort.direction === "descending",
    };
  });
  return [...rows].sort((left, right) => {
    for (const { property, spec, config, descending } of keys) {
      const a = cellOf(left, property);
      const b = cellOf(right, property);
      /* `isEmpty` is the registry's own answer to "is this nothing?", so this needs no
         knowledge of any type — and a type whose empty cells are not `null` (a text
         cell holding "") is covered without a special case. */
      const aEmpty = spec.isEmpty(a, config);
      const bEmpty = spec.isEmpty(b, config);
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      const result = spec.compare(a, b, config);
      if (result !== 0) return descending ? -result : result;
    }
    /* Final tie-break on the row's stored order, then id. Without it two rows with
       equal keys can swap places between renders, which reads as the table
       reshuffling itself for no reason. */
    return left.position - right.position || left.id.localeCompare(right.id);
  });
}

export function windowRows(rows: RowDef[], limit = 50, offset = 0): RowDef[] {
  return rows.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, limit));
}

/**
 * Grouping — what turns the same row set into a board.
 *
 * Groups keep first-seen order and the empty bucket goes last, because "no value"
 * is a place to put things, not the first thing a person wants to read. When the
 * Select and Status modules land, their option order will drive this instead; the
 * shape does not change, which is the point of doing it here once.
 */
export interface RowGroup { key: string; label: string; rows: RowDef[] }

export function groupRows(database: DatabaseSchema, rows: RowDef[], group: ViewConfig["group"]): RowGroup[] {
  if (!group) return [{ key: "", label: "", rows }];
  const property = propertyById(database, group.propertyId);
  const spec = resolveProperty(property as PropertyDef);
  const config = (property.config ?? {}) as Record<string, unknown>;
  const buckets = new Map<string, RowGroup>();
  for (const row of rows) {
    const value = cellOf(row, property);
    const empty = spec.isEmpty(value, config);
    const key = empty ? "" : JSON.stringify(value);
    const bucket = buckets.get(key) ?? { key, label: empty ? "No value" : spec.format(value, config), rows: [] };
    bucket.rows.push(row);
    buckets.set(key, bucket);
  }
  const order = [...buckets.values()].filter((bucket) => bucket.key !== "");
  const missing = buckets.get("");
  if (missing && !group.hideEmptyGroups) order.push(missing);
  return order.length ? order : [{ key: "", label: "No value", rows: [] }];
}

/** Everything a view needs, in one call. */
export interface RowSet {
  properties: PropertyDef[];
  groups: RowGroup[];
  rows: RowDef[];
  total: number;
}

/** Properties a view shows, in schema order, honouring `visibleProperties`. */
export function visibleProperties(database: DatabaseSchema, config: ViewConfig): PropertyDef[] {
  const all = [titlePropertyOf(database), ...database.properties];
  if (!config.visibleProperties.length) return all;
  const shown = new Set(config.visibleProperties);
  /* The primary property is never hidden: a table of rows with no name is a table
     of unidentifiable rows, and every escape from that state starts with knowing
     which row you are looking at. */
  return all.filter((property) => property.id === primaryPropertyId || shown.has(property.id));
}

/**
 * The pipeline, named once. Filter, then sort, then group, then window — in that
 * order and no other: grouping before sorting would sort inside groups and then
 * reorder the groups by first-seen row, and windowing before filtering would page
 * over rows the filter was about to remove.
 */
export function selectRows(database: DatabasePayload, config: ViewConfig, options: { limit?: number; offset?: number } = {}): RowSet {
  const filtered = database.rows.filter((row) => matches(database, row, config.filters));
  const sorted = sortRows(database, filtered, config.sorts);
  const rows = windowRows(sorted, options.limit ?? Number.MAX_SAFE_INTEGER, options.offset ?? 0);
  return {
    properties: visibleProperties(database, config),
    groups: groupRows(database, sorted, config.group),
    rows,
    total: filtered.length,
  };
}
