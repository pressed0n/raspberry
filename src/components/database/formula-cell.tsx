"use client";
/* A Formula cell: a value you cannot type into, and the one surface that decides it.
   ---------------------------------------------------------------------------
   The cell is a button like a tag, a date or a files cell — the fourth of them, which is
   why `.db-formula-trigger` joins the shared cell-as-button selector rather than copying
   its box. What it opens is not a picker but the formula editor: the expression, a
   preview of what it produces on a page you choose, and the list of everything a
   formula can say.

   Two things the cell itself has to get right:

   **A formula with nothing written yet says so.** An empty cell is indistinguishable
   from a formula that produced nothing, and those are different answers — "I have no
   formula" and "my formula says nothing for this row". The first reads `Add formula`,
   the second reads `Empty`, the same word every other column uses.

   **A failure is the cell's text.** `{ __error }` is what the read path stores for a
   formula that could not be evaluated on this row, and `formatCell` already turns it
   into the sentence. It is drawn in the error colour because a column of quiet sentences
   is a column people learn to ignore. */
import { useRef, useState } from "react";
import { formatCell } from "@/lib/database/properties";
import { expressionOf, isFormulaError } from "@/lib/database/formula";
import type { CellValue, PropertyDef, RowDef } from "@/lib/database/types";
import { FormulaPanel } from "./formula-panel";

export function FormulaCell({ property, value, properties, rows, onConfig }: {
  property: PropertyDef;
  value: CellValue;
  properties: PropertyDef[];
  rows: RowDef[];
  /* Absent in a read-only table: the value still reads, there is just nothing to press. */
  onConfig?: (patch: Record<string, unknown>) => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const expression = expressionOf(property);
  const text = formatCell(property, value);
  const failed = isFormulaError(value as never);

  /* Read-only: a formula is derived, so there is nothing to write and nothing to open. */
  if (!onConfig) {
    return <span className={text ? "db-formula-read" : "db-cell-empty"}>{text || "—"}</span>;
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="db-formula-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        /* The press must not blur the table, exactly like every other cell-as-button. */
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((was) => !was)}
        title={expression.trim() ? expression : "Write a formula for this column"}
      >
        {failed ? (
          /* The glyph, not only the colour: a column of quiet sentences is a column
             people learn to ignore, and a red word is not a signal to everybody. */
          <span className="db-formula-value is-error" title={text}>
            <span aria-hidden>⚠</span> {text}
          </span>
        ) : text ? (
          <span className="db-formula-value">{text}</span>
        ) : (
          <span className="db-cell-empty">{expression.trim() ? "Empty" : "Add formula"}</span>
        )}
      </button>
      {open ? (
        <FormulaPanel
          anchor={anchor}
          property={property}
          properties={properties}
          rows={rows}
          onCommit={(next) => { void onConfig({ expression: next }); }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
