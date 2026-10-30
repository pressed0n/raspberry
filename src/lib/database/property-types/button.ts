import { type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * Button — a column of actions, not a column of values.
 *
 * A button cell is `null` for every row and always will be: the thing the wishlist
 * wants ("Button") is the *action list* in `config.actions`, which the cell renders
 * as a control. It is declared `readOnly` so the write path refuses a value rather
 * than silently accepting one and having nowhere to put it.
 *
 * `format` returns nothing: a button has no **value**, so an export or a cell that
 * only knows how to draw text shows an empty cell. The label belongs to the control
 * in `config.label`, not to the value, and conflating the two would put "Send
 * invoice" in every CSV row of that column.
 */

interface ButtonConfig { label?: string; actions?: unknown[] }

export const buttonProperty: PropertyTypeSpec<ButtonConfig> = {
  type: "button",
  label: "Button",
  readOnly: true,
  empty: () => null,
  coerce: () => null,
  isEmpty: () => true,
  compare: () => 0,
  format: () => "",
  /* "Show rows where this button is empty" is every row, which is the honest answer. */
  fits: (operator) => operator === "isEmpty",
  aggregates: [],
};
