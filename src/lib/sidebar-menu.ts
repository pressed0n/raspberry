/* Raspberry — sidebar page menu (B25)
   ---------------------------------------------------------------------------
   Pure model for the per-row `⋯` menu: which verbs a page offers, which pages
   can be its new parent, and what a duplicate should be called.

   Nothing React-shaped lives here on purpose. The two rules worth protecting —
   never offer a destination that would make a cycle, and never overwrite a title
   when copying — are the kind that a browser probe proves once and a refactor
   breaks silently. Here they are cheap to test forever.
*/

export type PageNode = { id: string; parentId: string | null; title: string };

export type SidebarVerbId = "favorite" | "duplicate" | "rename" | "move" | "trash" | "tab";

export type SidebarVerb = {
  id: SidebarVerbId;
  label: string;
  /** Destructive verbs are separated from the rest and coloured. */
  danger?: boolean;
};

/* "Open in new tab" is worded in full because there is no icon that means it and
   `Open in tab` reads like plain "open" at a glance. Favourite flips its label
   rather than its verb: a menu row that is sometimes "Favourite" and sometimes
   "Unfavourite" makes you read the same word twice to find the one you want.

   No shortcut hints on these rows. The first draft carried `F2` and `Del` because
   Notion does, but nothing binds them here — and a menu that advertises a key that
   does nothing is worse than a menu that advertises nothing, which is the lesson
   the `Ctrl N` label already taught. */
export function menuItemsFor(page: { favorite: boolean }): SidebarVerb[] {
  return [
    { id: "favorite", label: page.favorite ? "Remove from Favorites" : "Add to Favorites" },
    { id: "tab", label: "Open in new tab" },
    { id: "rename", label: "Rename" },
    { id: "duplicate", label: "Duplicate" },
    { id: "move", label: "Move to" },
    { id: "trash", label: "Move to trash", danger: true },
  ];
}

/* Every descendant of `id`, not including `id`. Iterative with a guard: a cycle
   in existing data must not hang the sidebar on every render. */
export function descendantIds(pages: readonly PageNode[], id: string): Set<string> {
  const children = new Map<string | null, PageNode[]>();
  for (const page of pages) {
    const siblings = children.get(page.parentId) ?? [];
    siblings.push(page);
    children.set(page.parentId, siblings);
  }
  const found = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (child.id === id || found.has(child.id)) continue;
      found.add(child.id);
      queue.push(child.id);
    }
  }
  return found;
}

export type MoveTarget = {
  /** null is the "no parent" row — detached from the tree, not "unchanged". */
  id: string | null;
  title: string;
  /** Indentation level; 0 for the top-level row and for root pages. */
  depth: number;
  /** Where the page already lives. Shown, but not offered. */
  current: boolean;
  disabled: boolean;
};

/**
 * The destinations the "Move to" dialog offers, in the order the sidebar draws
 * them: top level first, then each page depth-first with its children below it.
 *
 * The moving page and its whole subtree are removed from the list before it is
 * flattened. That is the cycle rule, and doing it by removal rather than by a
 * per-row check is what makes it impossible to get wrong: a page that cannot be
 * drawn cannot be picked. The server refuses the same moves anyway — this is the
 * version that keeps the promise visible instead of letting you pick and fail.
 */
export function moveTargets(pages: readonly PageNode[], id: string): MoveTarget[] {
  const blocked = descendantIds(pages, id);
  blocked.add(id);
  const visible = pages.filter((page) => !blocked.has(page.id));
  const moving = pages.find((page) => page.id === id);
  const children = new Map<string | null, PageNode[]>();
  for (const page of visible) {
    const siblings = children.get(page.parentId) ?? [];
    siblings.push(page);
    children.set(page.parentId, siblings);
  }
  const rows: MoveTarget[] = [{
    id: null,
    title: "No parent (top level)",
    depth: 0,
    current: moving ? moving.parentId === null : false,
    disabled: moving ? moving.parentId === null : false,
  }];
  const walk = (parentId: string | null, depth: number) => {
    for (const page of children.get(parentId) ?? []) {
      const current = moving ? moving.parentId === page.id : false;
      rows.push({ id: page.id, title: page.title || "Untitled", depth, current, disabled: current });
      /* Depth is capped so a pathological tree cannot indent text off the row. */
      walk(page.id, Math.min(depth + 1, 6));
    }
  };
  walk(null, 1);
  return rows;
}

/** Filters destination rows. Ancestors of a match are kept so a match is not
 *  shown floating at depth 3 with no context above it. */
export function filterTargets(rows: readonly MoveTarget[], query: string): MoveTarget[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (!row.title.toLowerCase().includes(needle)) return;
    keep.add(index);
    /* Walk back to the nearest row shallower than this one and keep the chain. */
    let depth = row.depth;
    for (let back = index - 1; back >= 0 && depth > 0; back -= 1) {
      if (rows[back].depth < depth) { keep.add(back); depth = rows[back].depth; }
    }
  });
  return rows.filter((_, index) => keep.has(index));
}

const COPY = /\s*\(copy(?: (\d+))?\)$/i;

/**
 * The title a duplicate should take, given the titles already in the way.
 *
 * "Notes" becomes "Notes (copy)", and a second copy becomes "Notes (copy 2)"
 * rather than "Notes (copy) (copy)" — the suffix is replaced, not appended, so
 * copying a copy does not build a paragraph.
 */
export function copyTitle(title: string, taken: Iterable<string>): string {
  const base = (title.trim() || "Untitled").replace(COPY, "").trim() || "Untitled";
  const used = new Set<string>();
  for (const name of taken) used.add(name.trim().toLowerCase());
  const free = (candidate: string) => !used.has(candidate.toLowerCase());
  if (free(`${base} (copy)`)) return `${base} (copy)`;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} (copy ${index})`;
    if (free(candidate)) return candidate;
  }
  return `${base} (copy ${Date.now()})`;
}
