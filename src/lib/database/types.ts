import { z } from "zod";

/**
 * The database vocabulary.
 *
 * Sixteen property types and a growing list of view types were asked for, so the
 * types themselves are defined **once, here**, before a single one of them is
 * drawn. Everything downstream — the registry, the row-set pipeline, the API, the
 * MCP surface — reads from this file. Adding a type later means adding a module,
 * never a migration: `config` and `value` are JSON columns and are validated here.
 *
 * Nothing in this file touches React, the DOM or SQL. That is deliberate: the same
 * validation has to run in a route handler, in a unit test and (later) in the
 * formula evaluator.
 */

/* A JSON value, which is exactly what a cell holds and a property config is. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(jsonSchema), z.record(z.string(), jsonSchema),
]));

/* ---------------------------------------------------------------------------
   Property types — the wishlist, in its own words.
   --------------------------------------------------------------------------- */
export const propertyTypes = [
  "text",        // Text
  "number",      // Number (+ format, decimals, display, divide-by, show-number)
  "select",      // Select — one tag from a custom list
  "multiSelect", // Multi-select
  "status",      // Status — a Select whose tags live in customisable groups
  "date",        // Date (+ end date, format, hour/minute granularity)
  "checkbox",    // Checkbox
  "url",         // URL
  "email",       // Email
  "phone",       // Phone
  "person",      // Person (user)
  "files",       // Files & Media
  "formula",     // Formula — reads other properties
  "button",      // Button
  "createdTime", // Created time
  "place",       // Place/Location — accepts an address
] as const;
export type PropertyType = (typeof propertyTypes)[number];
export const propertyTypeSchema = z.enum(propertyTypes);

/* ---------------------------------------------------------------------------
   Shared pieces of a property config.
   --------------------------------------------------------------------------- */
/* Mirrors the palette in `theme.css` exactly — every name here has a
   `--palette-<name>-text` / `-background` pair to render with. */
export const tagColors = [
  "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
] as const;
export type TagColor = (typeof tagColors)[number];

/* One option in a Select / Multi-select / Status list. The id is what a cell
   stores, so renaming a tag is a single property update and every cell that
   references it follows — which is why options live in config rather than in
   their own table at this scale. */
export const optionSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(200),
  color: z.enum(tagColors).default("default"),
  /* Status only: which group this option belongs to. */
  groupId: z.string().nullable().default(null),
});
export type PropertyOption = z.infer<typeof optionSchema>;

/* Status groups. Notion locks To-do / In progress / Complete; the wishlist
   explicitly wants them editable, so the defaults are seeded and then ordinary
   data. `checked` is a *label* — the table draws a checked box before the chip of a
   tag whose group says so — and nothing about it filters or moves anything.
   `property-types/groups.ts` owns what an unstored column reads as. */
export const statusGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(200),
  color: z.enum(tagColors).default("default"),
  checked: z.boolean().default(false),
});
export type StatusGroup = z.infer<typeof statusGroupSchema>;

export const numberFormats = ["number", "separators", "currency", "percent", "duration"] as const;
export const numberDisplays = ["number", "bar", "ring"] as const;
export const dateFormats = ["iso", "dmy", "mdy", "long"] as const;
export const timeFormats = ["12", "24"] as const;

/* ---------------------------------------------------------------------------
   Per-type config. Every type gets its schema now, even the ones built in later
   phases, so a config written today cannot become invalid tomorrow.
   --------------------------------------------------------------------------- */
const emptyConfig = z.object({}).strict();

export const configSchemas = {
  text: emptyConfig,
  number: z.object({
    format: z.enum(numberFormats).default("number"),
    /* Currency code is presentation only; nothing converts. */
    currency: z.string().max(8).default("USD"),
    decimals: z.number().int().min(0).max(6).default(0),
    display: z.enum(numberDisplays).default("number"),
    color: z.enum(tagColors).default("default"),
    /* "Divide by X" from the wishlist: stored value, divided for display. */
    divideBy: z.number().default(1),
    showNumber: z.boolean().default(true),
  }),
  checkbox: emptyConfig,
  url: emptyConfig,
  email: emptyConfig,
  phone: emptyConfig,
  person: z.object({
    /* One user today; stored as a list so multi-user needs no migration. */
    limit: z.number().int().min(1).default(1),
  }),
  files: emptyConfig,
  createdTime: z.object({
    includeTime: z.boolean().default(true),
  }),
  place: z.object({
    /* Freeform first; geocoding autocomplete is a later, server-side concern. */
    requireAddress: z.boolean().default(false),
  }),
  select: z.object({
    options: z.array(optionSchema).default([]),
  }),
  multiSelect: z.object({
    options: z.array(optionSchema).default([]),
  }),
  status: z.object({
    options: z.array(optionSchema).default([]),
    groups: z.array(statusGroupSchema).default([]),
  }),
  date: z.object({
    format: z.enum(dateFormats).default("iso"),
    includeTime: z.boolean().default(false),
    timeFormat: z.enum(timeFormats).default("24"),
  }),
  formula: z.object({
    /* The expression is data, not code: it is parsed into an AST by the pure
       evaluator in `formula.ts`. Nothing here is ever passed to eval(). */
    expression: z.string().max(2000).default(""),
  }),
  button: z.object({
    label: z.string().max(80).default("Button"),
    actions: z.array(jsonSchema).default([]),
  }),
} satisfies Record<PropertyType, z.ZodTypeAny>;

/* ---------------------------------------------------------------------------
   Views.
   --------------------------------------------------------------------------- */
export const viewTypes = ["table", "board", "calendar", "list", "gallery"] as const;
export type ViewType = (typeof viewTypes)[number];
export const viewTypeSchema = z.enum(viewTypes);

export const filterOperators = [
  "is", "isNot", "contains", "doesNotContain", "isEmpty", "isNotEmpty",
  "equals", "notEquals", "greaterThan", "lessThan", "onOrBefore", "onOrAfter",
] as const;
export type FilterOperator = (typeof filterOperators)[number];

export const filterSchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  operator: z.enum(filterOperators),
  value: jsonSchema.default(null),
});

/* `manual` is the third direction, and it is not a synonym for the other two: it asks a
   type for the order a *person* arranged — the sequence the tags sit in inside the
   dropdown, which is the only order a Select column has that nobody can derive from the
   values. A type without such a sequence (`PropertyTypeSpec.order`) ignores it and falls
   back to `compare`, so a stored view can never be left with a sort that means nothing. */
export const sortDirections = ["ascending", "descending", "manual"] as const;
export type SortDirection = (typeof sortDirections)[number];

export const sortSchema = z.object({
  propertyId: z.string().min(1),
  direction: z.enum(sortDirections).default("ascending"),
});

export const groupSchema = z.object({
  propertyId: z.string().min(1),
  hideEmptyGroups: z.boolean().default(false),
});

/* Everything a view needs that is not its rows. Per view, persisted, and
   deliberately not stored in the page document — hiding a column must never
   create a draft conflict with typing. */
export const viewConfigSchema = z.object({
  visibleProperties: z.array(z.string()).default([]), // empty = all
  widths: z.record(z.string(), z.number()).default({}),
  filters: z.array(filterSchema).default([]),
  sorts: z.array(sortSchema).default([]),
  group: groupSchema.nullable().default(null),
  rowHeight: z.enum(["short", "medium", "tall"]).default("short"),
  wrapCells: z.boolean().default(false),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;

/* ---------------------------------------------------------------------------
   Wire shapes.
   --------------------------------------------------------------------------- */
export const cellValueSchema = jsonSchema;
export type CellValue = Json;

/**
 * The primary property is `pages.title`, not a row in `database_properties`.
 *
 * It still needs an id that views can sort by, filter on, hide and group by, so it
 * gets one fixed, reserved id. Reserving it cannot collide with a real property:
 * property ids are UUIDs generated by the server, and this is a plain word.
 */
export const primaryPropertyId = "title";
export const titleProperty: PropertyDef = { id: primaryPropertyId, name: "Name", type: "text", config: {}, position: -1 };

/**
 * The primary property's *name and icon* are per database, not per build.
 *
 * `titleProperty` above is the constant identity — the reserved id, the fixed type.
 * What a person calls the column ("Task", "Contact", "Invoice") and the icon beside it
 * are stored on the `databases` row as JSON and merged over the constant on read. It
 * has to live somewhere other than `database_properties`, because the primary property
 * deliberately has no row there: its values are `pages.title`, and a row in the
 * property table would be a second, divergent copy of the name.
 */
export const titlePropertyMetaSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  icon: z.string().max(80).optional(),
});
export type TitlePropertyMeta = z.infer<typeof titlePropertyMetaSchema>;

/** The constant identity, wearing this database's chosen name and icon. */
export function titlePropertyWith(meta?: TitlePropertyMeta | null): PropertyDef {
  const merged: PropertyDef = { ...titleProperty };
  if (meta?.name) merged.name = meta.name;
  if (meta?.icon !== undefined) merged.icon = meta.icon;
  return merged;
}

export interface PropertyDef {
  id: string;
  name: string;
  type: PropertyType;
  config: Record<string, unknown>;
  position: number;
  /* An icon *name*, resolved to a component in the editor. Empty or absent means
     "use the one this property type ships with", so no column is ever iconless. */
  icon?: string;
}

export interface ViewDef {
  id: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  position: number;
}

/* A row, as the client sees it. `title` is the primary property. */
export interface RowDef {
  id: string;
  title: string;
  icon: string;
  cells: Record<string, CellValue>;
  createdAt: string;
  updatedAt: string;
  position: number;
}

export interface DatabasePayload {
  id: string;
  pageId: string | null;
  title: string;
  icon: string;
  revision: number;
  /* The primary property, carrying this database's chosen name and icon. Absent
     means "the defaults": `titleProperty`. */
  titleProperty?: PropertyDef;
  properties: PropertyDef[];
  views: ViewDef[];
  rows: RowDef[];
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------------------
   Write inputs.
   --------------------------------------------------------------------------- */
export const createDatabaseSchema = z.object({
  pageId: z.string().uuid().nullable().default(null),
  title: z.string().max(200).default("Untitled database"),
  mutationId: z.string().min(8).max(200),
});

export const patchDatabaseSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: z.string().max(200).optional(),
  icon: z.string().max(64).optional(),
  mutationId: z.string().min(8).max(200),
});

export const createPropertySchema = z.object({
  name: z.string().max(200).default("Property"),
  type: propertyTypeSchema,
  config: jsonSchema.optional(),
  icon: z.string().max(80).optional(),
  mutationId: z.string().min(8).max(200),
});

export const patchPropertySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: jsonSchema.optional(),
  type: propertyTypeSchema.optional(),
  icon: z.string().max(80).optional(),
  /* The caller's "yes, I know the change clears values" — the answer to the 409 that
     names how many. Without it, a column holding anything the new type cannot read
     could never change type through the API at all, which is how the old guard behaved
     and why the menu had no Change type item. */
  clearUnconvertible: z.boolean().optional(),
  mutationId: z.string().min(8).max(200),
});

/**
 * Rows.
 *
 * A row is a page, so a row write is a *title* write plus a bag of cells. The two
 * arrive in one request because the table's first column and its other columns are
 * edited by the same gesture — typing in the Name cell of a new row — and splitting
 * them would put half a row on the server if the second request failed.
 *
 * An empty title is allowed and stored as `""`: the table renders `Untitled` as a
 * *placeholder*, not as text somebody has to delete first.
 */
export const createRowSchema = z.object({
  title: z.string().max(200).default(""),
  /* Insert directly below this row instead of at the bottom.
     
     The table's per-row `+` means "a page here", and "here" is not the end of the
     database. It is a *position*, which is why it is a field of the create rather than
     a second call: two calls would leave the new row at the bottom for one round trip,
     and a crash between them would leave it there for good. */
  after: z.string().min(1).optional(),
  mutationId: z.string().min(8).max(200),
});

/**
 * Duplicating or trashing one entry.
 *
 * Both verbs act on a row that already exists, so neither carries a body beyond the
 * replay id. `duplicate` takes no title: a copy is the same entry, not a new one with a
 * generated name, and the table shows the copy in place so it can be renamed straight
 * away. `trash` is a soft delete — the row's page keeps its content, its id and its
 * cells, so restoring it from Trash puts the entry back exactly where it was.
 */
export const rowMutationSchema = z.object({
  mutationId: z.string().min(8).max(200),
});

export const patchRowSchema = z.object({
  title: z.string().max(200).optional(),
  /* Keyed by property id. A `null` value clears the cell; a missing key leaves it
     alone, so two people editing different cells of one row never overwrite. */
  cells: z.record(z.string(), cellValueSchema).optional(),
  /* An entry's icon is `pages.icon` — an entry is a page, so this is the same column the
     sidebar reads. `NO_ICON` ("none") means "show nothing", which is why it is a value
     rather than an empty string: `pages.icon` is NOT NULL and "" is not a legal name. */
  icon: z.string().max(80).optional(),
  mutationId: z.string().min(8).max(200),
});

export const createViewSchema = z.object({
  name: z.string().max(200).default("View"),
  type: viewTypeSchema.default("table"),
  config: jsonSchema.optional(),
  mutationId: z.string().min(8).max(200),
});

export const patchViewSchema = z.object({
  name: z.string().max(200).optional(),
  config: jsonSchema.optional(),
  mutationId: z.string().min(8).max(200),
});

/**
 * Dragging a row by its grip.
 *
 * `ids` is the new order of the rows that moved. It may be the whole list or a subset
 * — the server keeps any row named in neither in its existing slot after the named
 * ones — because the table only ever shows *some* rows (a filter, a window) and a
 * caller should not have to know which.
 *
 * A reorder is not a field write, same as `move` on a page: it renumbers every row
 * it touches inside one transaction, and an index on its own would describe half of
 * that change.
 */
export const reorderRowsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(2000),
  mutationId: z.string().min(8).max(200),
});

/**
 * The default schema of a brand-new database.
 *
 * The wishlist lists `Name` as the *primary property*, not as a column with a
 * value of its own — in this model the primary property is `pages.title`, so a new
 * database starts with no property rows at all and the table renders Name as the
 * first column regardless. `+ Add Property` is what adds the rest.
 */
export function defaultPropertyConfig(type: PropertyType): Record<string, unknown> {
  return configSchemas[type].parse({}) as Record<string, unknown>;
}

/* A new database opens on one table view called "Table" — the wishlist's first
   item. Later views are added beside it as tabs. */
export const defaultViewConfig: ViewConfig = viewConfigSchema.parse({});
