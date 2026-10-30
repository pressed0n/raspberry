/**
 * Moving the cursor between cells.
 * ---------------------------------------------------------------------------
 * Tab already moves right: every editable cell is a real input or select, so the
 * browser's own focus order *is* the reading order of the table. Enter is the one key
 * that has no native meaning inside a grid and the one people press: in a table it means
 * "next row, same column", the way it does in any spreadsheet or database anyone has
 * used before this one.
 *
 * This is written against the DOM rather than against the data model on purpose. The
 * table it moves through is the table that is on screen — sorted, filtered, windowed and
 * grouped — and a traversal that walked `set.rows` would jump to a cell that is not
 * rendered. `cellIndex` and `rows` also mean the trailing "New page" row needs no special
 * case: it is a row like any other here, so Enter from the last data row lands in it.
 *
 * Read-only cells have no field to focus, so the search continues in the same direction
 * until it finds one: pressing Enter in a column of formulas must not swallow the key.
 */
export type Step = "down" | "up";

function field(root: HTMLTableCellElement | undefined): HTMLElement | null {
  if (!root) return null;
  /* Text-ish fields first, buttons second. A name cell contains the entry's icon *button*
     before its input, and matching `button` first put the cursor on the icon — the probe
     (`scripts/verify-database-b40.mjs`) reports which element got focus, which is how that
     was caught rather than shipped. A checkbox or button cell is still reachable: it is
     simply the last resort instead of the first match. */
  return root.querySelector<HTMLElement>("input, select, textarea") ?? root.querySelector<HTMLElement>("button");
}

export function focusCellFrom(from: HTMLElement, step: Step): boolean {
  const cell = from.closest<HTMLTableCellElement>("td");
  const row = cell?.parentElement as HTMLTableRowElement | null;
  const body = row?.parentElement as HTMLTableSectionElement | null;
  if (!cell || !row || !body || !body.rows) return false;
  const rows = Array.from(body.rows);
  const direction = step === "down" ? 1 : -1;
  /* Bounded by the number of rows: a column that is read-only all the way down fails
     once per row and then gives up, rather than looping forever looking for a field. */
  for (let index = rows.indexOf(row) + direction; index >= 0 && index < rows.length; index += direction) {
    const target = field(rows[index].cells[cell.cellIndex]);
    if (!target) continue;
    target.focus();
    /* Selecting the text is what makes the next keystroke *replace* the value instead of
       appending to it — the same thing Enter does in every other grid. */
    if (target instanceof HTMLInputElement) target.select();
    return true;
  }
  return false;
}
