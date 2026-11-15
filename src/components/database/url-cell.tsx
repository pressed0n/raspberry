"use client";
/* A URL cell: a link you can open, in a field you can still type into.
   ---------------------------------------------------------------------------
   The owner asked for two things that are easy to read as one: links in a URL column
   should be *clickable*, and the `https://www.` should be off the front. The second is a
   formatter (`link.ts`, which is also where a filter or the MCP surface reads it). The
   first is this file, and it is the harder half.

   What it must not become is a cell that navigates when you press the text. The same
   owner, one turn earlier: "A lot of the times when editing different cells i accidentally
   ... double click, which throws me inside the page ... i should only be able to open up
   the page by clicking the designated open button." A press on the words of a cell is how
   you put a caret in it — that is what every other column does, and a link that fired on
   that press would be a *harder* accident than the double-click was, one gesture earlier.

   So the address opens from a designated `↗` at the cell's right edge, and it is drawn by
   the row's own rule: `.db-open` and `.db-url-open` are revealed together, by the same
   `:hover`/`:focus-within`, and both take no clicks while invisible. Two openers, one
   vocabulary — press the words to edit, press the mark to leave.

   It is a real `<a href>` rather than a button with a click handler, because it is a link:
   the browser shows the address on hover, the middle button and ⌘-click work without this
   file knowing what they are, and `target="_blank"` keeps a half-written table on screen
   when the address turns out to be somewhere else. */

import { ArrowUpRight } from "lucide-react";
import { formatCell } from "@/lib/database/properties";
import { urlHref } from "@/lib/database/property-types/link";
import type { CellValue, PropertyDef } from "@/lib/database/types";

/**
 * The designated opener. `null` in, nothing out — an empty cell has no address to open, and
 * a disabled control that opens nothing is one more thing on screen pretending to work.
 */
export function UrlOpen({ value }: { value: CellValue }) {
  const href = urlHref(value);
  if (!href) return null;
  return (
    <a
      className="db-url-open"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Open link in a new tab"
      /* The full address, in the one place a person can read it while the cell shows the
         short one. A `title` that repeated the short form would be decoration. */
      title={href}
      /* Same as `.db-open`: the press must not take the caret out of the field underneath,
         because that blur commits a half-typed address on the way to opening the old one. */
      onMouseDown={(event) => event.preventDefault()}
    >
      <ArrowUpRight size={13} aria-hidden />
    </a>
  );
}

/**
 * Read-only tables have no field to type into, so there the *text* is the link — it is the
 * whole control, nothing competes with it, and a URL nobody can press in a view you cannot
 * edit is the bug this fixes rather than a risk it takes.
 */
export function UrlText({ property, value }: {
  property: Pick<PropertyDef, "type" | "config">;
  value: CellValue;
}) {
  const href = urlHref(value);
  const text = formatCell(property, value);
  if (!href) return <span className="db-cell-text">{text}</span>;
  return (
    <a className="db-cell-text db-url-text" href={href} target="_blank" rel="noreferrer noopener" title={href}>
      {text}
    </a>
  );
}
