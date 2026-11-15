"use client";
/* The cell editor — the one place that decides what "editing a value" looks like.
   ---------------------------------------------------------------------------
   It is deliberately NOT a per-type switch scattered through the table: the table
   calls this, this maps a property type to a control, and everything it commits is
   a raw value that the server's own `coerce` normalises. That is why a number typed
   into a text column still lands as a number in a number column, and why a new
   property type can ship with no editor at all and still be editable as text.

   A formula is computed rather than typed, so it has no field — but it is not inert
   either: `FormulaCell` opens the formula editor, which writes the *property's* config
   rather than a cell value. The two types that are genuinely facts rather than values
   (created time, button) render as text and say so by being unclickable. */
import { useEffect, useRef, useState } from "react";
import { focusCellFrom } from "@/lib/database/cell-nav";
import { formatCell } from "@/lib/database/properties";
import type { CellValue, PropertyDef, RowDef } from "@/lib/database/types";
import { OptionCell } from "./option-panel";
import { DateCell } from "./date-panel";
import { PlaceCell } from "./place-cell";
import { FilesCell } from "./files-cell";
import { FormulaCell } from "./formula-cell";
import { UrlOpen } from "./url-cell";

const noValue: ReadonlySet<PropertyDef["type"]> = new Set(["createdTime", "button"]);

export function CellEditor({ property, value, onCommit, onConfig, autoFocus, placeholder, formula }: {
  property: PropertyDef;
  value: CellValue;
  onCommit: (value: CellValue) => void;
  /* Only Select / Multi-select / Status use this: creating, renaming, recolouring or
     deleting a tag is a *property* write, not a cell write. Optional, because a
     read-only table has nothing to write to. A formula's whole definition goes through
     the same door. */
  onConfig?: (patch: Record<string, unknown>) => Promise<unknown> | void;
  autoFocus?: boolean;
  placeholder?: string;
  /* The rows and columns a formula editor previews against. Only the formula branch
     reads them; every other type ignores them. */
  formula?: { properties: PropertyDef[]; rows: RowDef[] };
}) {
  const text = formatCell(property, value);
  const [draft, setDraft] = useState(text);
  /* The committed value is read from a ref, not from `draft`. A blur that arrives in
     the same task as the last keystroke — Enter, or a click that React batches — runs
     the *previous* render's handler, and `draft` in that closure is one keystroke
     behind: the write would be dropped silently. The ref is always current. */
  const latest = useRef(text);
  const ref = useRef<HTMLInputElement | null>(null);

  /* The value can change under the editor — a second tab, a reload, the server
     correcting a coerce — so the field follows it unless the user is mid-keystroke
     in this very field. */
  useEffect(() => {
    if (document.activeElement === ref.current) return;
    setDraft(text);
    latest.current = text;
  }, [text]);

  if (property.type === "formula") {
    /* No field and no `onCommit`: the *expression* is the property's config, so the
       write goes through `onConfig` and the cell value is only ever read. */
    return (
      <FormulaCell
        property={property}
        value={value}
        properties={formula?.properties ?? []}
        rows={formula?.rows ?? []}
        onConfig={onConfig}
      />
    );
  }

  if (noValue.has(property.type)) {
    /* No `db-cell` here: this span is *inside* a `<td class="db-cell">`, and nesting the
       cell's own class inside the cell is what produced a box inside a box. The padding
       belongs to whichever element is the innermost one, and here that is this span. */
    return <span className={text ? "db-cell-readonly" : "db-cell-empty"}>{text || "—"}</span>;
  }

  if (property.type === "checkbox") {
    const on = value === true;
    /* The wrapper is not decoration. `.db-cell` is `vertical-align: top`, and a bare
       `inline-grid` tick participates in the cell's *line box*: an inline-grid's baseline is
       the bottom of the box when the grid is empty, but the baseline of its tick when it is
       not — so the same control drew 2.5px lower once it was checked, and 4px above the
       cell's centre either way. A flex row is a box of its own: the tick is a flex item, no
       baseline enters into it, and `align-items: center` centres it in the cell's content
       box at any row height. Measured, not assumed — `scripts/verify-db-checkbox.mjs`. */
    return (
      <div className="db-check-cell">
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          aria-label={property.name}
          className={on ? "db-check db-check-on" : "db-check"}
          onClick={() => onCommit(!on)}
        />
      </div>
    );
  }

  if (property.type === "select" || property.type === "status" || property.type === "multiSelect") {
    /* Not a `<select>`. A native select can only choose from options that already
       exist, so it could not create a tag, could not colour one, and on Multi-select
       it replaced the list instead of extending it. `OptionCell` owns all of that,
       including the property write that creates an option. */
    return <OptionCell property={property} value={value} onCommit={onCommit} onConfig={onConfig} autoFocus={autoFocus} />;
  }

  if (property.type === "date") {
    /* Not `<input type="date">`. A native date input holds one day: no end, no clock, and
       no way for the column to say how it reads. `DateCell` owns the range, the two
       clocks and the two toggles that make them. */
    return <DateCell property={property} value={value} onCommit={onCommit} onConfig={onConfig} autoFocus={autoFocus} />;
  }

  if (property.type === "place") {
    /* Place owns its own field rather than borrowing the shared one, because in this column
       the field is a *search box*: the arrows walk a result list instead of the grid, Enter
       means "take this one", and the first Escape dismisses the list rather than the edit.
       Borrowing the shared field and intercepting would have put those rules in two files. */
    return <PlaceCell property={property} value={value} onCommit={onCommit} autoFocus={autoFocus} />;
  }

  if (property.type === "files") {
    /* No field, because there is no text: pressing the cell opens the one surface that
       attaches files and lists what is attached. `db-cell-input` here was a text box that
       let you type a *name*, which stored a reference to bytes that were never uploaded. */
    return <FilesCell value={value} onCommit={onCommit} />;
  }

  /* The one text field. Five types render through it — Text, URL, Email, Phone, and
     anything a new type ships before it has an editor of its own — so it is built once and
     handed to whichever wrapper the type needs. Place has its own, because its field is a
     search box. */
  const field = (
    <input
      ref={(node) => { ref.current = node; }}
      className="db-cell-input"
      aria-label={property.name}
      autoFocus={autoFocus}
      value={draft}
      inputMode={property.type === "number" ? "decimal" : "text"}
      type="text"
      placeholder={placeholder ?? (property.type === "url" ? "example.com" : "Empty")}
      onChange={(event) => { setDraft(event.target.value); latest.current = event.target.value; }}
      onBlur={() => { if (latest.current !== text) onCommit(latest.current); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          /* Enter means "next row, same column" — and when there is no row below, it
             blurs, which commits. The blur is also what commits on the way down, so
             there is no second write path here: focus moving *is* the save. */
          if (!focusCellFrom(event.currentTarget, "down")) event.currentTarget.blur();
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          /* Arrows move the grid without touching the value, which is how a person reads
             a column; holding one down is therefore safe. */
          if (event.altKey || event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          focusCellFrom(event.currentTarget, event.key === "ArrowDown" ? "down" : "up");
        }
        if (event.key === "Escape") { setDraft(text); latest.current = text; event.currentTarget.blur(); }
      }}
    />
  );

  if (property.type === "url") {
    /* A link, with an opener. The field keeps the caret — see `url-cell.tsx` for why the
       text does not navigate — and the address opens from the mark at the cell's edge. */
    return (
      <div className="db-url-cell">
        {field}
        <UrlOpen value={value} />
      </div>
    );
  }

  return field;
}
