import { asText, collator, compareNullable, matchesText, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * Place / Location — "accepts address", in the wishlist's words.
 *
 * Stored as one freeform string. Geocoding, a map and an autocomplete belong on the
 * server (they are a network dependency, a key, and a cache), so they are a later
 * concern; what matters now is that the *cell* is settled — one string, no hidden
 * lat/lng fields a view might come to depend on before there is anything to fill
 * them with. When coordinates arrive they go in `config`-adjacent metadata or a
 * separate property, not inside this value.
 */

interface PlaceConfig { requireAddress?: boolean }

const addressOf = (value: CellValue): string => {
  /* Tolerates `{ address }` so a future geocoder can widen the value without a
     migration of every cell written today. */
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const address = (value as { address?: unknown }).address;
    return typeof address === "string" ? address.trim() : "";
  }
  return asText(value).trim();
};

export const placeProperty: PropertyTypeSpec<PlaceConfig> = {
  type: "place",
  label: "Place",
  empty: () => null,
  coerce: (raw) => {
    const address = addressOf(raw as CellValue);
    return address === "" ? null : address;
  },
  isEmpty: (value) => addressOf(value) === "",
  compare: (a, b) => compareNullable(
    addressOf(a) === "" ? null : addressOf(a),
    addressOf(b) === "" ? null : addressOf(b),
    collator.compare,
  ),
  format: (value) => addressOf(value),
  fits: (operator, value, operand) => matchesText(operator, value, operand),
  aggregates: ["count", "unique"],
};
