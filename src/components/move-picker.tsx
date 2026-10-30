"use client";
/* Raspberry — "Move to" dialog (B25)
   ---------------------------------------------------------------------------
   The body of the dialog the sidebar's `⋯ → Move to` opens: a list of every page
   that could become the parent, indented to the shape of the tree, with the page
   you are moving and its whole subtree absent.

   The absence is the design. A destination list that showed the illegal options
   greyed out would still make you read them; leaving them out means the only
   rows on screen are answers. `moveTargets` (src/lib/sidebar-menu.ts) does the
   excluding, so this file never decides what is legal.
*/

import { useMemo, useState } from "react";
import { CornerLeftUp, CornerRightDown, FolderInput } from "lucide-react";
import { filterTargets, moveTargets, type PageNode } from "@/lib/sidebar-menu";

export default function MovePicker({ pages, pageId, busy, onMove }: {
  pages: readonly PageNode[];
  pageId: string;
  busy: boolean;
  onMove: (parentId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  /* Recomputed only when the tree or the moving page changes, not per keystroke:
     the exclusion walk is cheap but it does not need to run on every character
     of a filter query. */
  const all = useMemo(() => moveTargets(pages, pageId), [pages, pageId]);
  const rows = useMemo(() => filterTargets(all, query), [all, query]);
  const bounded = Math.min(cursor, Math.max(rows.length - 1, 0));

  const choose = (row: (typeof rows)[number] | undefined) => {
    if (!row || row.disabled || busy) return;
    onMove(row.id);
  };

  return (
    <>
      <div className="panel-search">
        <FolderInput size={15} />
        <input
          autoFocus
          aria-label="Find a destination"
          placeholder="Find a destination…"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setCursor(Math.min(bounded + 1, rows.length - 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setCursor(Math.max(bounded - 1, 0)); }
            else if (event.key === "Enter") { event.preventDefault(); choose(rows[bounded]); }
          }}
        />
      </div>

      <div className="panel-list" role="listbox" aria-label="Destinations">
        {rows.map((row, index) => (
          <button
            key={row.id ?? "__root"}
            type="button"
            role="option"
            aria-selected={index === bounded}
            aria-disabled={row.disabled}
            className={`panel-item move-item${index === bounded ? " is-cursor" : ""}${row.disabled ? " is-disabled" : ""}`}
            style={{ paddingLeft: 12 + row.depth * 14 }}
            onMouseEnter={() => setCursor(index)}
            onClick={() => choose(row)}
          >
            {row.id === null ? <CornerLeftUp size={15} /> : <CornerRightDown size={15} />}
            <div>
              <strong>{row.title}</strong>
              {row.current && <span>Current location</span>}
            </div>
          </button>
        ))}
        {rows.length === 0 && <div className="panel-empty">No pages match.</div>}
      </div>

      <div className="panel-foot">
        <span><b>↑↓</b> move</span>
        <span><b>↵</b> choose</span>
        <span><b>esc</b> close</span>
      </div>
    </>
  );
}
