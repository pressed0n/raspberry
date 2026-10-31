import {
  asList,
  asText,
  collator,
  compareNullable,
  compareOptions,
  optionById,
  optionIdFrom,
  optionIdsOf,
  optionsOf,
  type OptionLike,
  type PropertyTypeSpec,
} from "./shared";
import type { CellValue } from "../types";
import { groupIdOf, groupsOf } from "./groups";

/**
 * Select, Multi-select and Status.
 * ---------------------------------------------------------------------------
 * Three types, one mechanism. A cell stores an option **id**; the option's name and
 * colour live in the property's config, so renaming a tag is a single property write
 * and every cell that references it follows.
 *
 *   select       one id, or null
 *   multiSelect  an array of ids (empty array is the empty cell — not null, because
 *                "nothing selected" and "this type has no value" are the same thing)
 *   status       one id, but ordered by the *group* it belongs to first
 *
 * The wishlist's one hard requirement on Status is that the groups are editable:
 * "Notion has the same but they are locked into those groups." That is why groups
 * are data in `config.groups` rather than an enum, and why nothing in this file
 * mentions To-do / In progress / Complete — `groups.ts` seeds those, and only for a
 * column whose groups have never been written.
 */

/** Status ordering: group position first, then the option's position inside it. */
function statusOrder(config: Record<string, unknown> | undefined): string[] {
  const groups = groupsOf(config);
  const options = optionsOf(config);
  const rank = (option: OptionLike): [number, number] => {
    /* `groupIdOf` answers with a group that exists — an option stored with a null or a
       deleted `groupId` belongs to the first one. Sorting through it is what keeps the
       arranged order and the panel's sections telling the same story. */
    const group = groups.findIndex((candidate) => candidate.id === groupIdOf(option, groups));
    return [Math.max(group, 0), options.findIndex((candidate) => candidate.id === option.id)];
  };
  return [...options]
    .sort((a, b) => {
      const [leftGroup, leftIndex] = rank(a), [rightGroup, rightIndex] = rank(b);
      return leftGroup - rightGroup || leftIndex - rightIndex;
    })
    .map((option) => option.id);
}

/* ---------------------------------------------------------------------------
   Names, for the alphabetical sort.
   ---------------------------------------------------------------------------
   A cell holds an id; "A → Z" is a promise about the *name* behind it. Resolving it
   through the property's config is the only way to keep that promise, and a tag that
   was deleted from the list while a cell still points at it has no name to give — it
   sorts by its own id rather than dropping out of the comparison.
   --------------------------------------------------------------------------- */

function nameOf(value: CellValue, config: Record<string, unknown> | undefined): string | null {
  const id = asText(value) || null;
  if (id === null) return null;
  return optionById(config, id)?.name ?? id;
}

/* Multi-select: alphabetical by tag, not by the order they were clicked. A cell stores
   its ids in pick order, so `[Apple, Zen]` and `[Zen, Apple]` are the same choice and
   must compare the same way. */
function namesOf(value: CellValue, config: Record<string, unknown> | undefined): string[] {
  const names: string[] = [];
  for (const item of asList(value)) {
    const name = nameOf(item, config);
    if (name !== null) names.push(name);
  }
  return names.sort(compareNames);
}

function compareNames(left: string, right: string): number {
  return collator.compare(left, right);
}

function compareNameLists(left: string[], right: string[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index++) {
    const result = compareNames(left[index], right[index]);
    if (result !== 0) return result;
  }
  /* Fewer tags first, so "Apple" reads before "Apple, Zen" — the arranged sort's main
     rule, demoted to the tie-break. */
  return left.length - right.length;
}

export const selectProperty: PropertyTypeSpec = {
  type: "select",
  label: "Select",
  empty: () => null,
  coerce: (raw, config) => optionIdFrom(asText(raw as CellValue), config),
  isEmpty: (value, config) => optionById(config, asText(value)) === null,
  /* `compare` is the name. It used to be the arranged order, which made the menu's
     "A → Z" a lie over a column that was never sorting alphabetically — and left the
     one order a tag column really has no way to be asked for by name. */
  compare: (a, b, config) => compareNullable(nameOf(a, config), nameOf(b, config), compareNames),
  /* The sequence a person arranged by dragging the grip in the tag menu. */
  order: (a, b, config) => compareOptions(config, asText(a) || null, asText(b) || null),
  format: (value, config) => optionById(config, asText(value))?.name ?? "",
  fits: (operator, value, operand, config) => {
    const left = asText(value) || null;
    const right = optionIdFrom(operand, config);
    switch (operator) {
      case "isEmpty": return left === null;
      case "isNotEmpty": return left !== null;
      case "is":
      case "equals": return left !== null && left === right;
      case "isNot":
      case "notEquals": return left !== right;
      default: return false;
    }
  },
  aggregates: ["count", "unique"],
};

export const multiSelectProperty: PropertyTypeSpec = {
  type: "multiSelect",
  label: "Multi-select",
  empty: () => [],
  coerce: (raw, config) => {
    /* A pasted "red, blue" becomes two tags; a single string becomes one. */
    const candidates = Array.isArray(raw)
      ? raw
      : asText(raw as CellValue).split(",").map((part) => part.trim()).filter(Boolean);
    const ids = candidates
      .map((candidate) => optionIdFrom(typeof candidate === "string" ? candidate : asText(candidate as CellValue), config))
      .filter((id): id is string => id !== null);
    return [...new Set(ids)];
  },
  isEmpty: (value) => asList(value).length === 0,
  compare: (a, b, config) => {
    const left = namesOf(a, config), right = namesOf(b, config);
    return compareNullable(left.length ? left : null, right.length ? right : null, compareNameLists);
  },
  order: (a, b, config) => {
    const left = asList(a).map((item) => asText(item)), right = asList(b).map((item) => asText(item));
    /* More tags sorts after fewer, then by the order the property lists the tags. */
    return compareNullable(left.length ? left : null, right.length ? right : null, (x, y) =>
      x.length - y.length || compareOptions(config, x[0] ?? null, y[0] ?? null));
  },
  format: (value, config) =>
    asList(value)
      .map((item) => optionById(config, asText(item))?.name)
      .filter((name): name is string => Boolean(name))
      .join(", "),
  /* `contains` is the operator that means "has this tag", which is the only question
     anyone asks of a multi-select column. */
  fits: (operator, value, operand, config) => {
    const ids = optionIdsOf(value, config);
    const probe = optionIdFrom(operand, config);
    const hit = probe !== null && ids.includes(probe);
    switch (operator) {
      case "isEmpty": return ids.length === 0;
      case "isNotEmpty": return ids.length > 0;
      case "contains": return hit;
      case "doesNotContain": return !hit;
      case "is":
      case "equals": return probe !== null && ids.length === 1 && hit;
      case "isNot":
      case "notEquals": return !hit;
      default: return false;
    }
  },
  aggregates: ["count", "unique"],
};

export const statusProperty: PropertyTypeSpec = {
  type: "status",
  label: "Status",
  empty: () => null,
  coerce: (raw, config) => optionIdFrom(asText(raw as CellValue), config),
  isEmpty: (value, config) => optionById(config, asText(value)) === null,
  compare: (a, b, config) => compareNullable(nameOf(a, config), nameOf(b, config), compareNames),
  /* A status column's arranged order is its groups, top to bottom, and each group's own
     order inside it — the thing the board reads in. It is the reason this direction
     exists at all: no alphabetical order can reconstruct it. */
  order: (a, b, config) => {
    const order = statusOrder(config);
    const rank = (id: string | null) => (id === null ? Number.MAX_SAFE_INTEGER : (order.indexOf(id) + 1 || Number.MAX_SAFE_INTEGER));
    return compareNullable(
      asText(a) === "" ? null : asText(a),
      asText(b) === "" ? null : asText(b),
      (left, right) => rank(left) - rank(right) || collator.compare(left, right),
    );
  },
  format: (value, config) => optionById(config, asText(value))?.name ?? "",
  /* A status filter may name a *group*, which is how "everything still in progress"
     is expressed without listing its options. */
  fits: (operator, value, operand, config) => {
    const left = asText(value) || null;
    const option = left === null ? null : optionById(config, left);
    const probe = optionIdFrom(operand, config);
    const groupHit = option !== null && groupsOf(config).some((group) =>
      collator.compare(group.name, asText(operand as CellValue)) === 0 && groupIdOf(option, groupsOf(config)) === group.id);
    switch (operator) {
      case "isEmpty": return option === null;
      case "isNotEmpty": return option !== null;
      case "is":
      case "equals": return groupHit || (probe !== null && left === probe);
      case "isNot":
      case "notEquals": return !groupHit && left !== probe;
      case "contains": return groupHit || (probe !== null && left === probe);
      case "doesNotContain": return !groupHit && left !== probe;
      default: return false;
    }
  },
  aggregates: ["count", "unique"],
};
