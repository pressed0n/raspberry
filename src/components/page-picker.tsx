"use client";
/* Raspberry — page picker (B22)
   ---------------------------------------------------------------------------
   The body of the "Open page" modal that the tab strip's + button opens.

   Why this exists: the + used to create an empty page, so wanting a second tab
   meant wanting a second blank document. Wanting a second tab is really a
   question — *which page?* — and a page you have not written yet is only one of
   the possible answers, so the answers go in a list.

   Rows are a single flat array so one cursor index covers both the "New page"
   row and the pages; keeping two cursors was the sort of thing that goes out of
   sync the moment the query empties while the cursor is at 3.
   --------------------------------------------------------------------------- */

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { PageSummary } from "@/lib/document";
import { PageGlyph } from "./page-glyph";

type Props = {
  pages: PageSummary[];
  /** Ids that already have a tab; picking one just activates it. */
  openIds: readonly string[];
  activeId: string | null;
  onPick: (id: string) => void;
  onCreate: () => void;
};

type Row = { kind: "new" } | { kind: "page"; page: PageSummary };

export default function PagePicker({ pages, openIds, activeId, onPick, onCreate }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const rows = useMemo<Row[]>(() => {
    const term = query.trim().toLowerCase();
    const matches = pages
      .filter((page) => !term || page.title.toLowerCase().includes(term))
      /* Alphabetical, not by recency: a picker is a lookup, and "where would I
         look for it" beats "what did I touch last" when you already know the name. */
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    const list: Row[] = matches.map((page) => ({ kind: "page", page }));
    /* Only offered on an empty query, so a search reads as pure results rather
       than as results with an unrelated action pinned above them. */
    return term ? list : [{ kind: "new" }, ...list];
  }, [pages, query]);

  const bounded = Math.max(0, Math.min(cursor, rows.length - 1));

  const run = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "new") onCreate();
    else onPick(row.page.id);
  };

  return (
    <>
      <div className="panel-field">
        <Search size={15} />
        <input
          autoFocus
          aria-label="Find a page"
          placeholder="Find a page…"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setCursor(Math.min(bounded + 1, rows.length - 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setCursor(Math.max(bounded - 1, 0)); }
            else if (event.key === "Enter") { event.preventDefault(); run(rows[bounded]); }
            else if (event.key === "Home" && !query) { event.preventDefault(); setCursor(0); }
          }}
        />
      </div>

      <div className="panel-list" role="listbox" aria-label="Pages">
        {rows.map((row, index) => {
          const selected = index === bounded;
          if (row.kind === "new") {
            return (
              <button
                key="__new"
                type="button"
                role="option"
                aria-selected={selected}
                className={`panel-item${selected ? " is-cursor" : ""}`}
                onMouseEnter={() => setCursor(index)}
                onClick={onCreate}
              >
                <Plus size={15} />
                <div><strong>New page</strong><span>Start from blank</span></div>
              </button>
            );
          }
          const { page } = row;
          const isOpen = openIds.includes(page.id);
          return (
            <button
              key={page.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={`panel-item${selected ? " is-cursor" : ""}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => onPick(page.id)}
            >
              <PageGlyph icon={page.icon} size={15} />
              <div>
                <strong>{page.title}</strong>
                {page.id === activeId ? <span>Current tab</span> : isOpen ? <span>Open in a tab</span> : null}
              </div>
            </button>
          );
        })}
        {rows.length === 0 && <div className="panel-empty">No pages match.</div>}
      </div>

      <div className="panel-foot">
        <span><b>↑↓</b> move</span>
        <span><b>↵</b> open</span>
        <span><b>esc</b> close</span>
      </div>
    </>
  );
}
