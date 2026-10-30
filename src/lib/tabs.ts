/* Raspberry — page tabs (B22)
   ---------------------------------------------------------------------------
   The tab set is a pure value: an ordered list of page ids plus which one is
   active. Nothing here touches React, the DOM, the network, or storage, which
   is why it can be tested directly — every rule below (what a close activates,
   what a reload restores, how a stale id is dropped) is a claim a browser test
   would only observe indirectly.

   The two invariants every function preserves:
     1. `ids` holds no duplicates.
     2. `active` is either null or a member of `ids`.
   --------------------------------------------------------------------------- */

/** Ordered page ids, plus the active one. `active === null` means no tab is open. */
export type TabsState = { ids: string[]; active: string | null };

/**
 * `replace` reuses the active tab's slot so the strip does not reshuffle when
 * you open something from the sidebar. `append` adds a tab (or just moves the
 * active marker if that page already has one).
 */
export type OpenMode = "replace" | "append";

export const EMPTY_TABS: TabsState = { ids: [], active: null };

/** Storage key. Kept out of the hook so the reload path and the hook agree. */
export const TABS_STORAGE_KEY = "raspberry:tabs";

export const isTabOpen = (state: TabsState, id: string): boolean => state.ids.includes(id);

export function openTab(state: TabsState, id: string, mode: OpenMode = "replace"): TabsState {
  if (!id) return state;
  if (state.ids.includes(id)) return { ids: state.ids, active: id };
  if (mode === "append" || state.active === null || !state.ids.includes(state.active)) {
    return { ids: [...state.ids, id], active: id };
  }
  // Replace in place: the new page inherits the slot of the tab it replaced.
  return { ids: state.ids.map((existing) => (existing === state.active ? id : existing)), active: id };
}

/** Activates an open tab. An id that is not open is ignored, not opened. */
export function activateTab(state: TabsState, id: string): TabsState {
  return state.ids.includes(id) && state.active !== id ? { ids: state.ids, active: id } : state;
}

export type CloseResult = { state: TabsState; closed: boolean };

/**
 * Closing the active tab activates its right neighbour, falling back to the
 * left, then to nothing. Closing any other tab leaves the active one alone —
 * including when the closed tab sits *before* it, since positions shift but
 * the active id does not.
 */
export function closeTab(state: TabsState, id: string): CloseResult {
  const index = state.ids.indexOf(id);
  if (index === -1) return { state, closed: false };
  const ids = state.ids.filter((existing) => existing !== id);
  if (state.active !== id) return { state: { ids, active: state.active }, closed: true };
  // After removal the element now at `index` is the right neighbour.
  const next = ids[index] ?? ids[index - 1] ?? null;
  return { state: { ids, active: next }, closed: true };
}

/** Moves a tab to a new index. Out-of-range targets clamp to the ends. */
export function moveTab(state: TabsState, from: number, to: number): TabsState {
  const count = state.ids.length;
  if (from < 0 || from >= count || from === to) return state;
  const target = Math.max(0, Math.min(count - 1, to));
  if (target === from) return state;
  const ids = [...state.ids];
  const [moved] = ids.splice(from, 1);
  ids.splice(target, 0, moved);
  return { ids, active: state.active };
}

/**
 * Drops tabs whose page no longer exists (deleted, trashed, or belonging to a
 * workspace that is no longer loaded). Order is preserved, and an active id
 * that disappears falls back to the first survivor rather than to null while
 * tabs remain.
 */
export function pruneTabs(state: TabsState, live: ReadonlySet<string>): TabsState {
  const ids = state.ids.filter((id) => live.has(id));
  if (ids.length === state.ids.length) return state;
  const active = state.active !== null && ids.includes(state.active) ? state.active : ids[0] ?? null;
  return { ids, active };
}

export const serializeTabs = (state: TabsState) => JSON.stringify({ ids: state.ids, active: state.active });

/**
 * Anything unreadable degrades to "no tabs" rather than throwing: a corrupt
 * storage record must not stop the app from opening a page. A dangling active
 * id resolves to the first tab, and duplicates are collapsed to one.
 */
export function parseTabs(raw: string | null): TabsState {
  if (!raw) return EMPTY_TABS;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return EMPTY_TABS; }
  const source = Array.isArray(value) ? { ids: value } : value;
  if (typeof source !== "object" || source === null) return EMPTY_TABS;
  const { ids: rawIds, active: rawActive } = source as { ids?: unknown; active?: unknown };
  if (!Array.isArray(rawIds)) return EMPTY_TABS;
  const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return EMPTY_TABS;
  const active = typeof rawActive === "string" && ids.includes(rawActive) ? rawActive : ids[0];
  return { ids, active };
}

/**
 * Combines stored tabs, the pages that actually exist, and the id in the URL on
 * load. A hash id that is not in the stored set replaces the active slot rather
 * than appending, so a deep link lands where you would expect. Returns null for
 * the hash when nothing can be honoured.
 */
export function restoreTabs(stored: TabsState, live: ReadonlySet<string>, hashId: string | null): TabsState {
  const pruned = pruneTabs(stored, live);
  if (!hashId || !live.has(hashId)) return pruned;
  return openTab(pruned, hashId, pruned.ids.includes(hashId) ? "append" : "replace");
}

/**
 * Index of the tab centre nearest the pointer. The drag handler feeds this the
 * measured centres of the tabs in DOM order and then hands the result straight
 * to `moveTab`, which treats it as the index in the *final* array. That works
 * because the dragged tab keeps its slot in the DOM until the drop, so the
 * measured order still matches the pre-move order.
 */
export function nearestIndex(centers: readonly number[], x: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  centers.forEach((center, index) => {
    const distance = Math.abs(center - x);
    if (distance < bestDistance) { best = index; bestDistance = distance; }
  });
  return best;
}
