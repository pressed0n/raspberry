import { formatCell, resolveProperty } from "./properties";
import type { CellValue, PropertyDef, PropertyType } from "./types";

/**
 * Changing a column's type.
 * ---------------------------------------------------------------------------
 * A type change is a *read* of the values already in the column through the new
 * type — never a guess and never a silent wipe. The rule is one line: take the text
 * the column was showing and ask the new type's own `coerce` to read it. That is why
 * this file contains no conversion table for the 16×16 matrix; the types already
 * know how to read text (a number reads "1 234,50", a checkbox reads "yes"), and the
 * only thing missing was somebody asking.

 * Two things this deliberately does **not** do:
 *
 * - It does not convert into types whose `coerce` expects structure rather than text
 *   (`select`, `date`, `files`, `person`, `multiSelect`, `status`). Reading a date's
 *   rendered label back as a date depends on the exact `dateFormat` config and would
 *   silently shift a day across a timezone; reading "Oct 30" as a number would store
 *   nothing. Those return `ok: false` and the caller refuses the change with a count,
 *   which is honest and reversible. Text is always available as a way through.
 * - It does not merge two values into one. A multi-select holding three tags becomes
 *   its displayed text ("red, blue, green") in a text column, and that is the value a
 *   person can see, edit, and split themselves.
 *
 * The one target that always succeeds is text, because a text column can say exactly
 * what the old column was showing. Every other path can decline, and declining is
 * the caller's cue to ask rather than to blank the column.
 */

/* Types whose `coerce` genuinely parses the text a column displays. Adding a type here
   is a claim that its `coerce` is a *text parser*; the assertion is guarded by
   `tests/database-type-change.test.ts`, which round-trips a value of every other type
   through text and checks each claim. */
export const textReadingTypes: ReadonlySet<PropertyType> = new Set<PropertyType>([
  "text", "number", "url", "email", "phone", "checkbox", "place",
]);

export type Conversion =
  | { ok: true; value: CellValue }
  | { ok: false };

const refused: Conversion = { ok: false };

/**
 * Reads one cell of `from` as `to`. `toConfig` must be the config the column will
 * have *after* the change, because `coerce` answers to it (a number's decimal
 * separator, a checkbox's labels).
 */
export function convertCell(
  from: PropertyDef,
  value: CellValue,
  to: PropertyType,
  toConfig: Record<string, unknown> = {},
): Conversion {
  const shown = formatCell(from, value);
  /* Nothing is nothing in every type, and it must not become "unreadable" just because
     a blank has no text to parse. */
  if (shown === "") return { ok: true, value: null };
  if (to === "text") return { ok: true, value: shown };
  if (to === from.type) return { ok: true, value };
  if (!textReadingTypes.has(to)) return refused;
  const spec = resolveProperty({ type: to });
  /* The value itself first — a number stays the number it was — then the text it was
     showing, which is what turns 1234.5 into "1 234,5" and back without a change. */
  const direct = spec.coerce(value, toConfig);
  if (direct !== null) return { ok: true, value: direct };
  const parsed = spec.coerce(shown, toConfig);
  return parsed === null ? refused : { ok: true, value: parsed };
}
