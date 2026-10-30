"use client";
/* The cell editor — the one place that decides what "editing a value" looks like.
   ---------------------------------------------------------------------------
   It is deliberately NOT a per-type switch scattered through the table: the table
   calls this, this maps a property type to a control, and everything it commits is
   a raw value that the server's own `coerce` normalises. That is why a number typed
   into a text column still lands as a number in a number column, and why a new
   property type can ship with no editor at all and still be editable as text.

   Three types have no editor because they have no value to type: a formula is
   computed, a created-time is a fact, and a button is an action. They render as text
   and say so by being unclickable. */
import { useEffect, useRef, useState } from "react";
import { optionIdsOf } from "@/lib/database/property-types/shared";
import { formatCell } from "@/lib/database/properties";
import type { CellValue, PropertyDef } from "@/lib/database/types";

const noValue: ReadonlySet<PropertyDef["type"]> = new Set(["formula", "createdTime", "button"]);

function optionsOf(property: PropertyDef) {
  const raw = (property.config as { options?: unknown }).options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const option = entry as { id?: unknown; name?: unknown };
    return typeof option.id === "string" ? [{ id: option.id, name: typeof option.name === "string" ? option.name : option.id }] : [];
  });
}

export function CellEditor({ property, value, onCommit, autoFocus, placeholder }: {
  property: PropertyDef;
  value: CellValue;
  onCommit: (value: CellValue) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const text = formatCell(property, value);
  const [draft, setDraft] = useState(text);
  /* The committed value is read from a ref, not from `draft`. A blur that arrives in
     the same task as the last keystroke — Enter, or a click that React batches — runs
     the *previous* render's handler, and `draft` in that closure is one keystroke
     behind: the write would be dropped silently. The ref is always current. */
  const latest = useRef(text);
  const ref = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  /* The value can change under the editor — a second tab, a reload, the server
     correcting a coerce — so the field follows it unless the user is mid-keystroke
     in this very field. */
  useEffect(() => {
    if (document.activeElement === ref.current) return;
    setDraft(text);
    latest.current = text;
  }, [text]);

  if (noValue.has(property.type)) {
    /* No `db-cell` here: this span is *inside* a `<td class="db-cell">`, and nesting the
       cell's own class inside the cell is what produced a box inside a box. The padding
       belongs to whichever element is the innermost one, and here that is this span. */
    return <span className={text ? "db-cell-readonly" : "db-cell-empty"}>{text || "—"}</span>;
  }

  if (property.type === "checkbox") {
    const on = value === true;
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={property.name}
        className={on ? "db-check db-check-on" : "db-check"}
        onClick={() => onCommit(!on)}
      />
    );
  }

  if (property.type === "select" || property.type === "status" || property.type === "multiSelect") {
    const options = optionsOf(property);
    const selected = new Set(optionIdsOf(value, property.config));
    const multiple = property.type === "multiSelect";
    return (
      <select
        ref={(node) => { ref.current = node; }}
        className={selected.size ? "db-cell-input" : "db-cell-input db-cell-empty"}
        aria-label={property.name}
        value={multiple ? "" : (options.find((option) => selected.has(option.id))?.id ?? "")}
        onChange={(event) => {
          const id = event.target.value;
          /* Multi-select commits an array and keeps what was there; the single
             flavours commit one id or null, because "no option" is a value a filter
             can ask for and a missing cell is not the same question. */
          if (multiple) onCommit(id ? [...selected, id] : []);
          else onCommit(id || null);
        }}
      >
        <option value="">{selected.size && multiple ? `${selected.size} selected` : ""}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    );
  }

  return (
    <input
      ref={(node) => { ref.current = node; }}
      className="db-cell-input"
      aria-label={property.name}
      autoFocus={autoFocus}
      value={draft}
      inputMode={property.type === "number" ? "decimal" : property.type === "date" ? "none" : "text"}
      type={property.type === "date" ? "date" : "text"}
      placeholder={placeholder ?? (property.type === "url" ? "https://" : "Empty")}
      onChange={(event) => { setDraft(event.target.value); latest.current = event.target.value; }}
      onBlur={() => { if (latest.current !== text) onCommit(latest.current); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.currentTarget.blur(); }
        if (event.key === "Escape") { setDraft(text); latest.current = text; event.currentTarget.blur(); }
      }}
    />
  );
}
