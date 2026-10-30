import { asList, asRecord, asText, collator, compareNullable, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * Person — a list of members, capped by `config.limit`.
 *
 * The wishlist says "Person (user)" and this install has one user, so the picker
 * shows one. The stored shape is a list anyway: multi-user is a config change
 * (`limit: 1 → null`), not a migration of every cell that ever held a person.
 * Getting that wrong is expensive later, and the cost of getting it right now is
 * one `Array` wrapper.
 */

interface PersonConfig { limit?: number }
/* The index signature is not decoration: a cell value is `Json`, so a person record
   has to be JSON-shaped for the value to be storable at all. */
interface PersonLike { [key: string]: CellValue; id: string; name: string }

const peopleOf = (value: CellValue): PersonLike[] =>
  asList(value)
    .map((item) => asRecord(item))
    .map((record) => (record && typeof record.id === "string"
      ? { id: record.id, name: typeof record.name === "string" ? record.name : record.id }
      : null))
    .filter((person): person is PersonLike => person !== null);

export const personProperty: PropertyTypeSpec<PersonConfig> = {
  type: "person",
  label: "Person",
  empty: () => [],
  coerce: (raw, config) => {
    /* Accepts `["id"]`, `[{ id, name }]`, or a comma-separated string. */
    const candidates = Array.isArray(raw)
      ? raw
      : asText(raw as CellValue).split(",").map((part) => part.trim()).filter(Boolean);
    const people: PersonLike[] = [];
    for (const candidate of candidates) {
      const record = asRecord(candidate as CellValue);
      const id = record && typeof record.id === "string" ? record.id : asText(candidate as CellValue).trim();
      if (id === "" || people.some((person) => person.id === id)) continue;
      people.push({ id, name: record && typeof record.name === "string" ? record.name : id });
    }
    const limit = typeof config?.limit === "number" && config.limit > 0 ? config.limit : people.length;
    return people.slice(0, limit) as CellValue;
  },
  isEmpty: (value) => peopleOf(value).length === 0,
  compare: (a, b) => compareNullable(
    peopleOf(a)[0] ?? null,
    peopleOf(b)[0] ?? null,
    (left, right) => collator.compare(left.name, right.name),
  ),
  format: (value) => peopleOf(value).map((person) => person.name).join(", "),
  fits: (operator, value, operand) => {
    const people = peopleOf(value);
    const probe = asText(operand as CellValue).trim();
    const hit = probe !== "" && people.some((person) =>
      person.id === probe || collator.compare(person.name, probe) === 0);
    switch (operator) {
      case "isEmpty": return people.length === 0;
      case "isNotEmpty": return people.length > 0;
      case "contains": return hit;
      case "doesNotContain": return !hit;
      case "is":
      case "equals": return hit && people.length === 1;
      case "isNot":
      case "notEquals": return !hit;
      default: return false;
    }
  },
  aggregates: ["count", "unique"],
};
