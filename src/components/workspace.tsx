"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine, BookOpen, ChevronDown, ChevronRight, Clock3, Copy,
  HelpCircle, LoaderCircle, LogOut, Menu, Moon, MoreHorizontal,
  Plus, Search, Settings2, Star, Sun, Trash2, Undo2, X,
} from "lucide-react";
import { download, request } from "@/lib/api-client";
import { toMarkdown, wordCount, type Page, type PageIcon, type PageSummary, type Revision } from "@/lib/document";
import { applyTheme, DEFAULT_THEME, nextTheme, readTheme, storeTheme, type Theme } from "@/lib/theme";
import { applyStoredPalette } from "@/lib/settings";
import { usePageDraft } from "./use-page-draft";
import { clearRecovery as clearRecoveryRecord, adoptChildPage, adoptMove, adoptRemote, anyRecordSaving, favoriteRecord, flushRecord, getRecord, markStale, recordIsDirty, releaseRecord, renameRecord, settleRecord, subscribe } from "@/lib/draft-registry";
import { blockEnd, dropTarget, isNoop, keyboardMove, resolveDrop, subtreeIds, type DragRow, type DropSite, type DropTarget } from "@/lib/sidebar-drag";
import DragLayer, { type GhostView, type LineView } from "./drag-layer";
import SettingsDialog from "./settings/dialog";
import {
  EMPTY_TABS, TABS_STORAGE_KEY, activateTab, closeTab, moveTab, openTab, parseTabs, pruneTabs,
  restoreTabs, serializeTabs, type TabsState,
} from "@/lib/tabs";
import { PageGlyph, PAGE_ICONS } from "./page-glyph";
import TabStrip from "./tab-strip";
import Crumbs from "./crumbs";
import PagePicker from "./page-picker";
import PageMenu from "./page-menu";
import MovePicker from "./move-picker";
import Modal from "./modal";
import { copyBlocks } from "@/lib/page-copy";
import { copyTitle, type SidebarVerbId } from "@/lib/sidebar-menu";
import { atPointer, atRect, type MenuAnchor } from "@/lib/menu-place";
import { livePagesChanged } from "@/lib/page-changes";
import { databasesChanged } from "@/lib/database-changes";
import { useLiveSync } from "./use-live-sync";

/**
 * Signs out and clears this device's drafts.
 *
 * The draft removal matters more than the request: unsaved text is kept in
 * `localStorage` so a lost connection cannot lose writing, which means on a shared
 * machine the next person could otherwise read whatever was typed before. Local mode
 * has no session, so the request fails harmlessly there and the drafts still go.
 */
async function signOut() {
  let hosted = true;
  try {
    const result = await request<{ mode?: string }>("/api/auth/logout", { method: "POST" });
    // In local mode there is no session to end and nobody to sign in as, so leaving the
    // user on a sign-in page would be a dead end.
    hosted = result?.mode === "session";
  } catch { /* Clearing the device is the point. */ }
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("raspberry")) localStorage.removeItem(key);
  } catch { /* Storage can be unavailable in private modes. */ }
  window.location.assign(hosted ? "/login" : "/");
}

/** "28 Oct" — a trash entry wants a day, not a clock. */
function deletedLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const BlockEditor = dynamic(() => import("./block-editor"), {
  ssr: false,
  loading: () => <div className="editor-loading"><LoaderCircle className="spin" size={16} />Opening page…</div>,
});

function RaspberryMark({ small = false }: { small?: boolean }) {
  return (
    <svg width={small ? 18 : 24} height={small ? 22 : 28} viewBox="0 0 32 38" fill="none" aria-hidden="true">
      <path d="M15 9C9 9 5 5 5 2c6-1 11 1 11 7M17 9c0-5 4-8 10-7-1 5-5 7-10 7" fill="currentColor" opacity="0.75" />
      <g fill="currentColor">
        <circle cx="10" cy="14" r="6" /><circle cx="22" cy="14" r="6" /><circle cx="6" cy="24" r="5.5" />
        <circle cx="16" cy="24" r="6" /><circle cx="26" cy="24" r="5.5" /><circle cx="11" cy="32" r="5" />
        <circle cx="21" cy="32" r="5" />
      </g>
    </svg>
  );
}


/**
 * Where to draw the insertion line for a gap drop (B28).
 *
 * "before" sits on the anchor row's top edge. "after" sits on the bottom edge of the
 * anchor's whole *block* — if the anchor is expanded, its children are drawn under it, so
 * a line on the anchor's own bottom edge would point at a slot between a parent and its
 * child, which is not a slot at all. `blockEnd` resolves that; the resulting line is the
 * one place the drop can legally land.
 */
function dropLine(rows: readonly DragRow[], rects: Record<string, { left: number; width: number }>, target: DropTarget | null): LineView | null {
  if (!target || target.kind === "inside") return null;
  const anchor = target.kind === "before" ? rows.find((row) => row.id === target.id) ?? null : blockEnd(rows, target.id);
  const rect = anchor ? rects[anchor.id] : undefined;
  if (!anchor || !rect) return null;
  return { x: rect.left, y: target.kind === "before" ? anchor.top : anchor.top + anchor.height, width: rect.width };
}

export default function Workspace() {
  const [pages, setPages] = useState<PageSummary[]>([]);
  /* Page content is fetched lazily: only the active tab needs it, so a tab costs
     one request the first time it is shown, not at load. */
  const [loaded, setLoaded] = useState<Record<string, Page>>({});
  const [tabs, setTabs] = useState<TabsState>(EMPTY_TABS);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(false), [dialog, setDialog] = useState<"search" | "trash" | "help" | "open" | "settings" | null>(null);
  const [query, setQuery] = useState(""), [searchResults, setSearchResults] = useState<PageSummary[]>([]), [trash, setTrash] = useState<PageSummary[]>([]);
  /* Trash panel (B27): the trash had no search, no permanent delete and no way to
     tell two pages with the same name apart — so once it filled up it could only
     grow, and the only way to remove a page from it was to restore and re-trash it. */
  const [trashQuery, setTrashQuery] = useState(""), [purgeArmed, setPurgeArmed] = useState<string | null>(null), [emptyArmed, setEmptyArmed] = useState(false), [trashError, setTrashError] = useState("");
  const [searchBusy, setSearchBusy] = useState(false), [actionBusy, setActionBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  /* B25 sidebar row state. `rowMenu` carries the anchor read at open time
     because the menu is portalled and needs viewport coordinates — a button rect
     when `⋯` opened it, a point when a right-click did (B37); `moving` is the
     id being re-parented and `renaming` the id being renamed in place. */
  const [rowMenu, setRowMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  /* False until the stored tabs and the page list have been reconciled, so the
     persistence effect below cannot overwrite storage with the empty default
     during the first render. */
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set<string>());
  /* B28 drag state. `dragRef` is the authoritative copy: pointermove fires faster than
     React renders, and a handler that read `dragView` would be aiming at a position one
     frame old. `dragView` exists only so the ghost and the insertion line get drawn.

     Row geometry is captured once, when the gesture arms — the same lesson the tab strip
     paid for: hit testing against a layout the drag is currently changing makes the
     target flip back and forth between two mutually disagreeing layouts. */
  const [dragView, setDragView] = useState<{ id: string; ghost: GhostView; line: LineView | null; over: DropTarget | null } | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; armed: boolean; rows: DragRow[]; rects: Record<string, { left: number; width: number; height: number }>; blocked: Set<string>; target: DropTarget | null; ghost: GhostView } | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);

  const active = tabs.active;
  const page = active ? loaded[active] ?? null : null;
  const closeDialog = useCallback(() => { setDialog(null); setQuery(""); setCursor(0); }, []);
  const refresh = useCallback(async () => { const result = await request<{ pages: PageSummary[] }>("/api/pages"); setPages(result.pages); return result.pages; }, []);

  /** Saves a tab now. A page that was never opened has nothing to save. */
  const saveTab = useCallback(async (id: string | null) => {
    if (!id) return true;
    const record = getRecord(id);
    return record ? flushRecord(record) : true;
  }, []);

  const loadPage = useCallback(async (id: string) => {
    const result = await request<{ page: Page }>(`/api/pages/${id}`);
    setLoaded((current) => ({ ...current, [id]: result.page }));
    return result.page;
  }, []);

  /* ---------- live sync (B56) ----------
     Two devices, one workspace. The poller asks the server once a second whether
     the workspace's digest moved; when it has it hands back the open tabs'
     summaries, and this reconciles them.

     The order in the loop is the whole of "never lose a keystroke":

       - a revision this tab already holds is not news. Most entries are this,
         because the digest is workspace-wide and reports every tab whenever
         anything anywhere moves.
       - a *dirty* record is warned about and never fetched. Fetching it and then
         declining to use it would be a request whose only possible outcome is the
         warning, and adopting it would delete what the person is typing.
       - a page trashed or purged elsewhere is skipped: `refresh` closes its tab,
         and remounting an editor that is about to disappear is worse than the
         half-second it would be correct for.

     `refresh` is not called here. The poller decides that separately, because the
     list matters when the page *set* changed and not when someone edited text. */
  const reconcile = useCallback(async (watched: PageSummary[]) => {
    for (const entry of watched) {
      const record = getRecord(entry.id);
      if (!record || entry.deletedAt) continue;
      if (entry.revision <= record.sync.persisted.revision) continue;
      if (recordIsDirty(entry.id)) { markStale(entry.id, "This page was changed on another device. Your unsaved edits are kept."); continue; }
      adoptRemote(entry.id, await loadPage(entry.id));
    }
  }, [loadPage]);

  useLiveSync({
    watch: () => tabs.ids,
    busy: anyRecordSaving,
    onPages: (watched) => { void reconcile(watched); },
    onCollection: () => refresh(),
    onDatabases: databasesChanged,
  });

  /**
   * Commits a drop (B28).
   *
   * Flushed first and revision-aware, for the same reason trash is: the page being moved
   * may also be the page being typed in, and its record holds a revision the server is
   * one write away from rejecting. `adoptMove` then hands the new revision back to the
   * record — without it the next autosave is a 409 and the page goes quietly unsaveable.
   */
  const movePage = useCallback(async (id: string, site: DropSite) => {
    setActionBusy(true);
    try {
      if (!(await saveTab(id))) return;
      const settled = await settleRecord(id);
      if (!settled.ok) throw new Error("This page has unsaved changes that could not be saved.");
      const revision = settled.revision ?? (await request<{ page: Page }>(`/api/pages/${id}`)).page.revision;
      const result = await request<{ page: Page }>(`/api/pages/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ parentId: site.parentId, index: site.index, expectedRevision: revision, mutationId: crypto.randomUUID() }),
      });
      adoptMove(id, result.page);
      await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setActionBusy(false); }
  }, [saveTab, refresh]);

  /**
   * Arms a drag from a tree row. Nothing is captured and nothing is drawn yet — a press
   * that turns out to be a click must stay a click, which is exactly what went wrong on
   * the tab strip when capture was taken on pointerdown.
   */
  const rowDragStart = (item: PageSummary) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    /* The twist, the "add subpage" button and `⋯` are controls with their own jobs;
       arming a drag over them would swallow their click. */
    if ((event.target as HTMLElement).closest(".tree-twist, .tree-add, .tree-more")) return;
    const root = treeRef.current;
    if (!root) return;
    const rows: DragRow[] = [], rects: Record<string, { left: number; width: number; height: number }> = {};
    root.querySelectorAll<HTMLElement>("[data-row-id]").forEach((element) => {
      const rect = element.getBoundingClientRect(), id = element.dataset.rowId ?? "";
      if (!id) return;
      rects[id] = { left: rect.left, width: rect.width, height: rect.height };
      rows.push({ id, parentId: element.dataset.parentId || null, depth: Number(element.dataset.depth ?? 0), top: rect.top, height: rect.height });
    });
    const own = rects[item.id];
    if (!own) return;
    dragRef.current = {
      id: item.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, armed: false,
      rows, rects, target: null,
      /* A page can never land inside itself — the server refuses it, and a drop the UI
         drew as legal has to land, so the dragged subtree is excluded from hit testing. */
      blocked: subtreeIds(pages, item.id),
      ghost: { title: item.title, icon: <PageGlyph icon={item.icon} size={16} />, x: 0, y: 0, width: own.width, height: own.height },
    };
  };

  /* Window-level, so a drag that leaves the sidebar still tracks and still ends. Capture
     is deliberately not used: it retargets pointerup, and the browser then fires `click`
     at the nearest common ancestor — the tab strip's dead-click bug. */
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      if (!state.armed) {
        if (Math.abs(event.clientX - state.startX) < 4 && Math.abs(event.clientY - state.startY) < 4) return;
        state.armed = true;
      }
      /* Below and right of the pointer, not centred on it: the row being hovered is *at* the
         pointer's y, so a ghost centred there covers the very highlight that says the drop
         will nest. Offsetting keeps the target readable while the ghost still travels with
         the cursor. */
      state.ghost = { ...state.ghost, x: event.clientX + 14, y: event.clientY + 12 };
      const target = dropTarget(state.rows, event.clientY, state.blocked);
      state.target = target;
      setDragView({ id: state.id, ghost: state.ghost, line: dropLine(state.rows, state.rects, target), over: target });
    };
    const finish = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      dragRef.current = null;
      setDragView(null);
      if (!state.armed) return;
      const site = resolveDrop(pages, state.target, state.id);
      /* A drop that changes nothing must not call the API: it would bump a revision and
         could 409 against that page's own autosave, for a move nobody asked for. */
      if (isNoop(pages, state.id, site) || !site) return;
      void movePage(state.id, site);
    };
    const cancel = () => { if (!dragRef.current) return; dragRef.current = null; setDragView(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [pages, movePage]);

  /**
   * Opens a page in a tab. `append` is for Ctrl+click, middle-click and creation.
   *
   * Unlike the single-page version this does not flush the outgoing page first:
   * its draft record outlives the editor, so switching cannot lose an edit and
   * does not need a round-trip to be safe.
   */
  const openPage = useCallback(async (id: string, mode: "replace" | "append" = "replace") => {
    setSidebar(false); closeDialog();
    if (!loaded[id]) {
      setBusy(true);
      try { await loadPage(id); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open page."); setBusy(false); return; }
      setBusy(false);
    }
    setError("");
    setTabs((current) => openTab(current, id, mode));
  }, [loaded, loadPage, closeDialog]);

  /** Activates a tab that is already open. Separate from `openPage` so the strip
      does not close the sidebar or clear dialogs as a side effect. */
  const activate = useCallback(async (id: string) => {
    if (!loaded[id]) {
      setBusy(true);
      try { await loadPage(id); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open page."); setBusy(false); return; }
      setBusy(false);
    }
    setTabs((current) => activateTab(current, id));
  }, [loaded, loadPage]);

  const closeOne = useCallback(async (id: string, { discard = false } = {}) => {
    const record = getRecord(id);
    const saved = await releaseRecord(id, { discard });
    if (!saved) {
      // The draft is already kept in browser storage, so refusing is safe and the
      // user keeps their tab. "Close without saving" in the tab menu is the exit.
      setError(record?.snapshot.message || "Unable to save this page, so the tab was kept.");
      return;
    }
    setTabs((current) => closeTab(current, id).state);
    setLoaded((current) => { const next = { ...current }; delete next[id]; return next; });
  }, []);

  const closeMany = useCallback(async (keep: string[]) => {
    const closing = tabs.ids.filter((id) => !keep.includes(id));
    for (const id of closing) {
      if (!(await releaseRecord(id))) return;
      setTabs((current) => closeTab(current, id).state);
      setLoaded((current) => { const next = { ...current }; delete next[id]; return next; });
    }
  }, [tabs.ids]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await refresh();
        if (!alive) return;
        const live = new Set(list.map((entry) => entry.id));
        let stored = EMPTY_TABS;
        try { stored = parseTabs(localStorage.getItem(TABS_STORAGE_KEY)); }
        catch { /* Storage is unavailable; a fresh single tab is a fine outcome. */ }
        let restored = restoreTabs(stored, live, location.hash.slice(1) || null);
        // Nothing worth restoring: open the first page so the app never starts blank.
        if (restored.ids.length === 0 && list[0]) restored = openTab(restored, list[0].id, "replace");
        setTabs(restored);
        if (restored.active) await loadPage(restored.active);
      } catch (cause) { if (alive) setError(cause instanceof Error ? cause.message : "Unable to load workspace."); }
      finally { if (alive) { setBusy(false); setReady(true); } }
    })();
    return () => { alive = false; };
  }, [refresh, loadPage]);

  // Persist the tab set, and mirror the active tab into the URL so a reload and a
  // copied link both land on the same page. `replaceState` keeps the app out of
  // browser history, matching the behaviour before tabs existed.
  /* `/settings` is a redirect to `/?settings=1` since B31, so the old URL still
     lands somewhere. Opening the dialog here and dropping the parameter keeps
     the address bar matching the screen, and a reload does not re-open it.
     Declared before the tab-hash effect below because that one rewrites the URL
     to `#<pageId>` and would take the parameter with it. */
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("settings")) return;
    url.searchParams.delete("settings");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setDialog("settings");
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(TABS_STORAGE_KEY, serializeTabs(tabs)); } catch { /* Nothing to persist. */ }
    if (tabs.active) history.replaceState(null, "", `#${tabs.active}`);
  }, [tabs, ready]);

  // Tabs whose page has gone (deleted, trashed as a subtree elsewhere) are dropped.
  // Guarded on a non-empty list so a failed refresh cannot close everything.
  useEffect(() => {
    if (!ready || pages.length === 0) return;
    const live = new Set(pages.map((entry) => entry.id));
    setTabs((current) => pruneTabs(current, live));
    setLoaded((current) => {
      const kept = Object.entries(current).filter(([id]) => live.has(id));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  }, [pages, ready]);

  // One subscription per open tab, feeding the dot on a tab with unsaved work.
  // The set is only replaced when its contents actually change, so typing does
  // not re-render the sidebar and everything else in here on every keystroke.
  useEffect(() => {
    const read = () => {
      const next = tabs.ids.filter((id) => getRecord(id)?.snapshot.dirty);
      setDirty((current) => next.length === current.size && next.every((id) => current.has(id)) ? current : new Set(next));
    };
    read();
    const unsubscribes = tabs.ids.map((id) => {
      const record = getRecord(id);
      return record ? subscribe(record, read) : () => {};
    });
    return () => { unsubscribes.forEach((off) => off()); };
  }, [tabs.ids]);

  // The stored preference wins over the default. Read after mount so the server
  // and client first render agree on `data-theme="dark"`.
  useEffect(() => {
    const stored = readTheme();
    setTheme(stored);
    applyTheme(stored);
    // Settings live beside the theme and have the same pre-paint path; applying
    // here covers the case where the bootstrap script was blocked.
    applyStoredPalette(stored);
  }, []);
  const toggleTheme = () => {
    const next = nextTheme(theme);
    setTheme(next);
    storeTheme(next);
    applyTheme(next);
    // The palette has a value per theme, so the vars have to be rewritten with it.
    applyStoredPalette(next);
  };

  const create = useCallback(async (parentId: string | null = null) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const result = await request<{ page: Page }>("/api/pages", { method: "POST", body: JSON.stringify({ title: "Untitled", parentId, mutationId: crypto.randomUUID() }) });
      await refresh();
      /* Nesting a page is two server-side writes: `parent_id`, which the tree draws,
         and a pageLink appended to the parent's content, which the parent page shows.
         A parent that is already open here still holds the document from before that
         append — in `loaded` for the next time its tab is shown, and in its draft
         record for its next save — so it is brought up to date now. Otherwise the
         child exists only in the sidebar, and the parent's next save deletes the
         block that put it inside the page. */
      if (parentId) {
        try {
          const parent = await loadPage(parentId);
          adoptChildPage(parentId, parent);
        } catch { /* The child is created either way; the parent retries on the next open. */ }
      }
      // A new page opens in its own tab rather than replacing what you were
      // reading — creating from inside a page should not cost you your place.
      setLoaded((current) => ({ ...current, [result.page.id]: result.page }));
      setTabs((current) => openTab(current, result.page.id, "append"));
      setSidebar(false); closeDialog();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create page."); }
    finally { setActionBusy(false); }
  }, [actionBusy, loadPage, refresh, closeDialog]);

  /* Latest handlers for the global listener, which is bound once. A ref rather
     than dependencies: re-binding a window listener on every tab change is churn
     for no benefit. */
  const shortcuts = useRef({
    active: null as string | null, ids: [] as string[],
    save: () => {}, create: () => {}, activate: (_id: string) => {}, close: (_id: string) => {}, move: (_from: number, _to: number) => {}, nudgePage: (_direction: "up" | "down") => {},
  });
  shortcuts.current = {
    active, ids: tabs.ids,
    save: () => void saveTab(active),
    create: () => void create(null),
    activate: (id: string) => void activate(id),
    close: (id: string) => void closeOne(id),
    move: (from: number, to: number) => setTabs((current) => moveTab(current, from, to)),
    nudgePage: (direction: "up" | "down") => {
      if (!active) return;
      const site = keyboardMove(pages, active, direction);
      if (site) void movePage(active, site);
    },
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const state = shortcuts.current;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") { event.preventDefault(); setDialog((current) => current === "search" ? null : "search"); return; }
      if (meta && event.key.toLowerCase() === "s") { event.preventDefault(); state.save(); return; }
      // Alt, not Ctrl: Ctrl+T, Ctrl+W and Ctrl+N are reserved by the browser and
      // cannot be intercepted, so advertising them would be a promise we cannot
      // keep. (The sidebar used to say "Ctrl N" for New page and bind nothing.)
      if (!event.altKey || meta) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); state.create(); return; }
      if (event.key.toLowerCase() === "w" && state.active) { event.preventDefault(); state.close(state.active); return; }
      if (event.key >= "1" && event.key <= "9") {
        const id = state.ids[Number(event.key) - 1];
        if (id) { event.preventDefault(); state.activate(id); }
        return;
      }
      if (event.shiftKey && state.active && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const from = state.ids.indexOf(state.active);
        if (from === -1) return;
        event.preventDefault();
        state.move(from, from + (event.key === "ArrowRight" ? 1 : -1));
        return;
      }
      /* Alt+↑/↓ reorders the page itself among its siblings (B28). Shift+←/→ above moves
         the *tab*; this moves the *page*, which is a different list. */
      if (!event.shiftKey && state.active && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        state.nudgePage(event.key === "ArrowUp" ? "up" : "down");
      }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (dialog !== "search") return;
    const controller = new AbortController(); setSearchBusy(true);
    const timeout = setTimeout(() => {
      request<{ pages: PageSummary[] }>(`/api/pages?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((result) => setSearchResults(result.pages))
        .catch((cause) => { if (cause.name !== "AbortError") setError(cause.message); })
        .finally(() => { if (!controller.signal.aborted) setSearchBusy(false); });
    }, 150);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [dialog, query]);
  const reloadTrash = useCallback(async () => {
    const result = await request<{ pages: PageSummary[] }>("/api/pages?trash=1");
    setTrash(result.pages);
  }, []);
  const openTrash = async () => {
    setTrashError(""); setTrashQuery(""); setPurgeArmed(null); setEmptyArmed(false);
    try { await reloadTrash(); setDialog("trash"); } catch (cause) { setError((cause as Error).message); }
  };
  /* Restore and purge report inside the panel, not through the app-wide banner:
     that banner renders behind the modal, so a refusal there was invisible — which
     is exactly how "restore its parent first" came to look like a dead button. */
  const restore = async (id: string) => {
    setActionBusy(true); setTrashError("");
    try {
      await request(`/api/pages/${id}/restore`, { method: "POST" });
      await refresh(); await reloadTrash();
      /* B40h — a restored page can be an entry in a database table, which holds its own
         snapshot of its rows. Without this the table kept the gap until a reload. */
      livePagesChanged();
    }
    catch (cause) { setTrashError(cause instanceof Error ? cause.message : "That page could not be restored."); }
    finally { setActionBusy(false); }
  };
  const purge = async (id: string) => {
    setActionBusy(true); setTrashError("");
    try { await request(`/api/pages/${id}/purge`, { method: "DELETE" }); setPurgeArmed(null); await reloadTrash(); }
    catch (cause) { setTrashError(cause instanceof Error ? cause.message : "That page could not be deleted."); }
    finally { setActionBusy(false); }
  };
  const emptyTrash = async () => {
    setActionBusy(true); setTrashError("");
    try { await request("/api/trash", { method: "DELETE" }); setEmptyArmed(false); await reloadTrash(); }
    catch (cause) { setTrashError(cause instanceof Error ? cause.message : "The trash could not be emptied."); }
    finally { setActionBusy(false); }
  };
  const onSaved = useCallback((saved: Page) => {
    setPages((current) => current.map((item) => item.id === saved.id ? saved : item));
    setLoaded((current) => current[saved.id] ? { ...current, [saved.id]: saved } : current);
  }, []);
  /* Renaming a page has to move the tab label, the sidebar row and the last
     breadcrumb now, not when the 700ms save debounce clears. The save still
     confirms it (`onSaved` above); this only stops the title and the page's name
     from disagreeing for a second, which reads as a bug rather than as latency.
     The tab's dirty dot is what says the value is not yet on disk. */
  const onTitleDraft = useCallback((id: string, title: string) => {
    setPages((current) => current.some((item) => item.id === id && item.title !== title)
      ? current.map((item) => item.id === id ? { ...item, title } : item)
      : current);
  }, []);
  /* The page that was just deleted loses its tab; the refresh drops any tab whose
     page went with it (a trashed subtree takes its descendants' tabs too). */
  const onRemoved = useCallback(async (id: string) => {
    setTabs((current) => closeTab(current, id).state);
    setLoaded((current) => { const next = { ...current }; delete next[id]; return next; });
    await refresh();
    /* B40h — the page may have been an entry in a database table, which is a view of its
       own that this callback cannot reach. See `page-changes.ts`. */
    livePagesChanged();
  }, [refresh]);

  /* ---------- sidebar row verbs (B25) ----------
     Every verb that writes goes through `settleRecord` first. The sidebar's copy of
     a page is the last list result, and its revision is stale the moment the page
     has pending edits — acting on it would 409 on the page you were most recently
     typing in, which is the one you are most likely to right-click. */

  const closeRowMenu = useCallback(() => setRowMenu(null), []);

  /* Shared by the tree rows and the favourites shortcuts, so the two cannot drift
     apart. Re-clicking an open row's button closes its menu: the menu opens to the
     right of the button and does not cover it, so a second click has to mean
     "close" rather than being swallowed. */
  const toggleRowMenu = useCallback((id: string, anchor: MenuAnchor) => {
    setRowMenu((current) => current?.id === id ? null : { id, anchor });
  }, []);

  /* B37 — a right-click always *opens*, so it gets its own setter rather than
     sharing the toggle above. A second right-click on the same row means "put the
     menu here instead", and toggling would close it, which reads as the click
     having been ignored. */
  const openRowMenu = useCallback((id: string, anchor: MenuAnchor) => setRowMenu({ id, anchor }), []);

  /* One handler for both row renders so they cannot drift. Two refusals that are
     correctness, not polish:

     1. A right-click inside the rename field belongs to the field. Swapping the
        browser's cut/copy/paste menu for six page verbs would make renaming the
        one place in the sidebar where text editing gets harder.
     2. The keyboard menu key (Shift+F10) reports clientX/clientY as 0, which
        would open the menu in the viewport's top-left corner, nowhere near the
        focused row — so a zero point falls back to the row's own rect. */
  const rowContextMenu = (item: PageSummary) => (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input, textarea")) return;
    event.preventDefault();
    if (event.clientX === 0 && event.clientY === 0) {
      openRowMenu(item.id, atRect(event.currentTarget.getBoundingClientRect()));
    } else {
      openRowMenu(item.id, atPointer(event.clientX, event.clientY));
    }
  };

  const commitRename = useCallback(async (id: string, title: string) => {
    setRenaming(null);
    const summary = pages.find((item) => item.id === id);
    const next = title.trim() || "Untitled";
    if (!summary || next === summary.title) return;
    /* Optimistic, because the tab label and the breadcrumb read from the list and
       a rename that lands a second later looks like it did not take. */
    onTitleDraft(id, next);
    try {
      if (await renameRecord(id, next)) return;
      const settled = await settleRecord(id);
      if (!settled.ok) throw new Error("This page has unsaved changes that could not be saved.");
      await request(`/api/pages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: settled.revision ?? summary.revision, mutationId: crypto.randomUUID(), title: next }),
      });
      await refresh();
    } catch (cause) {
      onTitleDraft(id, summary.title);
      setError(cause instanceof Error ? cause.message : "Unable to rename this page.");
    }
  }, [pages, refresh, onTitleDraft]);

  const commitMove = useCallback(async (parentId: string | null) => {
    const id = moving;
    const summary = id ? pages.find((item) => item.id === id) : undefined;
    if (!id || !summary) { setMoving(null); return; }
    setActionBusy(true);
    try {
      const settled = await settleRecord(id);
      if (!settled.ok) throw new Error("This page has unsaved changes that could not be saved.");
      await request(`/api/pages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: settled.revision ?? summary.revision, mutationId: crypto.randomUUID(), parentId }),
      });
      setMoving(null);
      /* A page moved into a collapsed parent would vanish: the move worked and the
         sidebar looks untouched. Open the destination so the result is visible. */
      if (parentId) setCollapsed((current) => { const next = new Set(current); next.delete(parentId); return next; });
      await refresh();
    } catch (cause) {
      setMoving(null);
      setError(cause instanceof Error ? cause.message : "Unable to move this page.");
    } finally { setActionBusy(false); }
  }, [moving, pages, refresh]);

  const runVerb = useCallback(async (id: string, verb: SidebarVerbId) => {
    const summary = pages.find((item) => item.id === id);
    setRowMenu(null);
    if (!summary) return;
    if (verb === "tab") { void openPage(id, "append"); return; }
    if (verb === "rename") { setRenaming(id); return; }
    if (verb === "move") { setMoving(id); return; }
    if (actionBusy) return;
    setActionBusy(true);
    try {
      if (verb === "favorite") {
        /* Through the draft record when the page is open. A direct PATCH bumps the
           server revision behind the record's back, which 409s the editor's next
           save and then blocks that page for the rest of the session — the page you
           were looking at could no longer be saved after being favourited. */
        const saved = await favoriteRecord(id, !summary.favorite);
        if (saved === false) throw new Error("This page has unsaved changes that could not be saved.");
        if (saved === null) {
          /* Nothing open to keep in step, but the sidebar's copy of the revision can
             still lag a save that happened elsewhere, so read before writing. */
          const current = await request<{ page: Page }>(`/api/pages/${id}`);
          await request(`/api/pages/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ expectedRevision: current.page.revision, mutationId: crypto.randomUUID(), favorite: !current.page.favorite }),
          });
        }
        await refresh();
      } else if (verb === "duplicate") {
        /* Read the source fresh rather than from `loaded`: the copy must contain
           what is on the server now, and `loaded` is only populated for pages that
           have been opened in this session. */
        await settleRecord(id);
        const source = await request<{ page: Page }>(`/api/pages/${id}`);
        const created = await request<{ page: Page }>("/api/pages", {
          method: "POST",
          body: JSON.stringify({
            title: copyTitle(summary.title, pages.map((item) => item.title)),
            parentId: summary.parentId, linkInParent: false, mutationId: crypto.randomUUID(),
          }),
        });
        await request(`/api/pages/${created.page.id}`, {
          method: "PATCH",
          body: JSON.stringify({ expectedRevision: created.page.revision, mutationId: crypto.randomUUID(), content: copyBlocks(source.page.content) }),
        });
        await refresh();
      } else if (verb === "trash") {
        const settled = await settleRecord(id);
        if (!settled.ok) throw new Error("This page has unsaved changes that could not be saved.");
        /* `settleRecord` only carries a revision for a page that is open. For a
           closed one the sidebar's copy can lag a save made elsewhere, and the
           server refuses a DELETE whose revision is behind — so read the current
           revision instead of guessing with `summary.revision`. */
        const revision = settled.revision ?? (await request<{ page: Page }>(`/api/pages/${id}`)).page.revision;
        await request(`/api/pages/${id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: revision }) });
        /* The trashed subtree takes its open tabs with it, and any recovery copy
           left in `localStorage` would resurrect a deleted page's text. */
        clearRecoveryRecord(id); releaseRecord(id);
        await onRemoved(id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action did not complete.");
    } finally { setActionBusy(false); }
  }, [pages, actionBusy, refresh, openPage, onRemoved]);

  const children = (id: string) => pages.filter((item) => item.parentId === id);
  const tree = (parent: string | null, depth = 0): ReactNode => pages.filter((item) => item.parentId === parent).map((item) => {
    const kids = children(item.id), open = !collapsed.has(item.id);
    return <div key={item.id}>
      <div
        className={`tree-row ${page?.id === item.id ? "is-active" : ""} ${dragView?.id === item.id ? "is-dragging" : ""} ${dragView?.over?.kind === "inside" && dragView.over.id === item.id ? "is-drop-parent" : ""}`}
        style={{ paddingInlineStart: 6 + depth * 11 }}
        data-row-id={item.id} data-parent-id={item.parentId ?? ""} data-depth={depth}
        onPointerDown={rowDragStart(item)}
        onContextMenu={rowContextMenu(item)}
      >
        {kids.length ? <button
          className="tree-twist" aria-label={open ? `Collapse ${item.title}` : `Expand ${item.title}`} aria-expanded={open}
          onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}
        >{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button> : <span className="tree-gap" />}
        {renaming === item.id ? <RenameField
          title={item.title}
          onCommit={(title) => void commitRename(item.id, title)}
          onCancel={() => setRenaming(null)}
        /> : <button
          className="tree-link"
          onClick={(event) => void openPage(item.id, event.ctrlKey || event.metaKey ? "append" : "replace")}
          onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); void openPage(item.id, "append"); } }}
          disabled={busy}
        >
          <PageGlyph icon={item.icon} /><span>{item.title}</span>
        </button>}
        <button className="tree-add" title="Add a subpage" aria-label={`Add subpage to ${item.title}`} onClick={() => void create(item.id)} disabled={actionBusy}><Plus size={13} /></button>
        <PageOptionsButton page={item} open={rowMenu?.id === item.id} onOpen={toggleRowMenu} />
      </div>
      {kids.length && open ? tree(item.id, depth + 1) : null}
    </div>;
  });
  /* Trash panel derivations. Sorted newest deletion first — a trash is searched by
     "what did I just get rid of", not alphabetically. Filtering is local: the list
     is already in memory, so it is instant and needs no request per keystroke. */
  const titleOf = (id: string) => pages.find((item) => item.id === id)?.title ?? trash.find((item) => item.id === id)?.title ?? "";
  const trashNeedle = trashQuery.trim().toLowerCase();
  const visibleTrash = trash
    .filter((item) => !trashNeedle || item.title.toLowerCase().includes(trashNeedle) || titleOf(item.parentId ?? "").toLowerCase().includes(trashNeedle))
    .sort((left, right) => (right.deletedAt ?? "").localeCompare(left.deletedAt ?? ""));
  const favorites = pages.filter((item) => item.favorite);

  // One strip, rendered by whichever shell is showing, so tabs stay reachable
  // while a page is still loading or nothing is open.
  const strip = <TabStrip
    ids={tabs.ids} active={active} pages={pages} dirty={dirty}
    onActivate={(id) => void activate(id)}
    onClose={(id) => void closeOne(id)}
    onDiscard={(id) => void closeOne(id, { discard: true })}
    onCloseOthers={(id) => void closeMany([id])}
    onCloseRight={(id) => void closeMany(tabs.ids.slice(0, tabs.ids.indexOf(id) + 1))}
    onOpenPicker={() => setDialog("open")}
    onReorder={(from, to) => setTabs((current) => moveTab(current, from, to))}
  />;

  return <div className={`app ${sidebar ? "is-open" : ""}`}>
    {sidebar && <button className="scrim-side" aria-label="Close sidebar" onClick={() => setSidebar(false)} />}

    <aside className={`sidebar ${sidebar ? "is-open" : ""}`} aria-label="Workspace navigation">
      <div className="brand">
        <span className="brand-mark"><RaspberryMark small /></span>
        <span className="brand-name">Raspberry</span>
      </div>

      <div className="side-actions">
        <button className="side-row" onClick={() => setDialog("search")}><Search size={15} /><span>Search</span><kbd>Ctrl K</kbd></button>
        <button className="side-row" onClick={() => void create(null)} disabled={actionBusy}><Plus size={15} /><span>New page</span><kbd>Alt N</kbd></button>
      </div>

      {favorites.length > 0 && <div className="side-section">
        <div className="section-head">Favourites</div>
        <div className="tree">
          {favorites.map((item) => <div
            className="tree-row" key={item.id} style={{ paddingInlineStart: 6 }}
            data-row-id={item.id}
            onContextMenu={rowContextMenu(item)}
          >
            <span className="tree-gap" />
            <button
              className="tree-link"
              onClick={(event) => void openPage(item.id, event.ctrlKey || event.metaKey ? "append" : "replace")}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); void openPage(item.id, "append"); } }}
              disabled={busy}
            >
              <Star size={13} className="is-on" /><span>{item.title}</span>
            </button>
            {/* Favourites are shortcuts to the same pages the tree lists, so they
                carry the same menu and the same right-click. A page you can
                right-click in one place and not in another teaches you not to
                trust either. */}
            <PageOptionsButton page={item} open={rowMenu?.id === item.id} onOpen={toggleRowMenu} />
          </div>)}
        </div>
      </div>}

      <div className="side-section is-grow">
        <div className="section-head">Pages</div>
        <div className="tree" ref={treeRef}>
          {pages.length ? tree(null) : <div className="panel-empty">No pages yet.</div>}
        </div>
      </div>

      <div className="side-foot">
        {/* Settings (B31) is a dialog now, not a route: clicking it must not
            throw the page you are reading out of the viewport. `/settings`
            still exists as a redirect for old links. */}
        <button className="side-row" onClick={() => setDialog("settings")}><Settings2 size={15} /><span>Settings</span></button>
        <button className="side-row" onClick={() => void openTrash()}><Trash2 size={15} /><span>Trash</span></button>
        <button className="side-row" onClick={() => setDialog("help")}><HelpCircle size={15} /><span>Shortcuts</span></button>
        <button className="side-row" onClick={() => void signOut()}><LogOut size={15} /><span>Sign out</span></button>
        <div className="status-line">
          <span className="status-dot" />
          <span>Local only</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={toggleTheme} aria-label={`Switch to ${nextTheme(theme)} theme`} title={`Switch to ${nextTheme(theme)} theme`}>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>
    </aside>

    <main className="main">
      {page
        ? <PageEditor
          key={active} page={page} pages={pages} theme={theme} strip={strip}
          onSaved={onSaved}
          onTitleDraft={onTitleDraft}
          onMenu={() => setSidebar(true)}
          onCreated={async (created) => {
            await refresh();
            setLoaded((current) => ({ ...current, [created.id]: created }));
            setTabs((current) => openTab(current, created.id, "append"));
          }}
          onOpenPage={openPage}
          onPagesChanged={refresh}
          onRemoved={onRemoved}
          onError={setError}
        />
        : <EmptyShell strip={strip} onMenu={() => setSidebar(true)} busy={busy} onCreate={() => void create(null)} disabled={actionBusy} />}
    </main>

    {/* Rendered last and portalled to <body>: it must sit above every panel, and the
        sidebar's filtered ancestor would otherwise become its containing block. */}
    <DragLayer ghost={dragView?.ghost ?? null} line={dragView?.line ?? null} />

    {dialog === "open" && <Modal title="Open page" onClose={closeDialog}>
      <PagePicker
        pages={pages}
        openIds={tabs.ids}
        activeId={active}
        /* Append, never replace: asking for a tab and losing the tab you were
           reading would be the same complaint in a new place. */
        onPick={(id) => void openPage(id, "append")}
        onCreate={() => void create(null)}
      />
    </Modal>}

    {dialog === "search" && <Modal title="Search" onClose={closeDialog}>
      <div className="panel-field">
        <Search size={15} />
        <input
          aria-label="Search pages" placeholder="Search pages…" value={query} autoFocus
          onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setCursor((index) => Math.min(index + 1, searchResults.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setCursor((index) => Math.max(index - 1, 0)); }
            if (event.key === "Enter" && searchResults[cursor]) { event.preventDefault(); void openPage(searchResults[cursor].id); }
          }}
        />
        {searchBusy && <LoaderCircle className="spin" size={14} />}
      </div>
      <div className="panel-list">
        {searchResults.length ? searchResults.map((item, index) => <button
          key={item.id} className={`panel-item ${index === cursor ? "is-cursor" : ""}`}
          onMouseEnter={() => setCursor(index)} onClick={() => void openPage(item.id)}
        >
          <PageGlyph icon={item.icon} /><span className="panel-item-title">{item.title}</span>
        </button>) : <div className="panel-empty">{query ? "No pages match." : "No pages yet."}</div>}
      </div>
      <div className="panel-foot"><span><b>↑↓</b> move</span><span><b>↵</b> open</span><span><b>esc</b> close</span></div>
    </Modal>}

    {dialog === "trash" && <Modal title="Trash" onClose={closeDialog}>
      <div className="panel-field">
        <Search size={15} />
        <input
          value={trashQuery} onChange={(event) => setTrashQuery(event.target.value)} autoFocus
          placeholder="Find in trash" aria-label="Find in trash"
        />
        {trashQuery && <button className="icon-btn" onClick={() => setTrashQuery("")} aria-label="Clear the search"><X size={14} /></button>}
      </div>
      <div className="panel-list">
        {visibleTrash.length ? visibleTrash.map((item) => {
          /* Restoring a page whose parent is still in the trash is refused by the
             server, so the button is not offered — a control that cannot work is
             worse than no control, and the reason is right next to it. */
          const parentTrashed = !!item.parentId && trash.some((row) => row.id === item.parentId);
          const parentTitle = item.parentId ? titleOf(item.parentId) : "";
          return <div className="panel-item trash-row" key={item.id}>
            <PageGlyph icon={item.icon} />
            <div>
              <span className="panel-item-title">{item.title}</span>
              <span className="panel-item-meta">
                {item.deletedAt ? `Deleted ${deletedLabel(item.deletedAt)}` : "In the trash"}
                {parentTrashed ? " · restore its parent first" : parentTitle ? ` · in ${parentTitle}` : ""}
              </span>
            </div>
            {purgeArmed === item.id
              ? <>
                <button className="btn-ghost is-danger" disabled={actionBusy} onClick={() => void purge(item.id)}>Delete forever</button>
                <button className="btn-ghost" onClick={() => setPurgeArmed(null)}>Keep</button>
              </>
              : <>
                <button className="btn-ghost" disabled={actionBusy || parentTrashed} onClick={() => void restore(item.id)}><Undo2 size={13} />Restore</button>
                <button className="icon-btn" disabled={actionBusy} onClick={() => setPurgeArmed(item.id)} aria-label={`Delete ${item.title} forever`} title="Delete forever"><Trash2 size={14} /></button>
              </>}
          </div>;
        }) : <div className="panel-empty">
          {trash.length ? "Nothing in the trash matches that." : "The trash is empty."}
        </div>}
      </div>
      <div className="panel-foot">
        {trashError
          ? <span className="trash-error" role="alert">{trashError}</span>
          : emptyArmed
            ? <>
              <span>Delete <b>{trash.length}</b> {trash.length === 1 ? "page" : "pages"} for good?</span>
              <span className="spacer" />
              <button className="btn-ghost is-danger" disabled={actionBusy} onClick={() => void emptyTrash()}>Delete forever</button>
              <button className="btn-ghost" onClick={() => setEmptyArmed(false)}>Keep</button>
            </>
            : <>
              <span>{trash.length ? <><b>{trash.length}</b> {trash.length === 1 ? "page" : "pages"}</> : "Nothing deleted"}</span>
              {/* The hint is the first thing to go when the footer would wrap: the
                  count and the verbs are what the panel is for. */}
              <span className="foot-hint">· restoring a page brings its subpages back</span>
              <span className="spacer" />
              <button className="btn-ghost is-danger" disabled={!trash.length || actionBusy} onClick={() => setEmptyArmed(true)}>Empty trash</button>
            </>}
      </div>
    </Modal>}

    {dialog === "help" && <Modal title="Shortcuts" onClose={closeDialog}>
      <div className="panel-list">
        <div className="panel-item"><span className="panel-item-title">Find a page</span><kbd>Ctrl / ⌘ K</kbd></div>
        <div className="panel-item"><span className="panel-item-title">Save now</span><kbd>Ctrl / ⌘ S</kbd></div>
        <div className="panel-item"><span className="panel-item-title">New page</span><kbd>Alt N</kbd></div>
        <div className="panel-item"><span className="panel-item-title">Close tab</span><kbd>Alt W</kbd></div>
        <div className="panel-item"><span className="panel-item-title">Switch tab</span><kbd>Alt 1–9</kbd></div>
        <div className="panel-item"><span className="panel-item-title">Move tab</span><kbd>Alt ⇧ ← →</kbd></div>
        <div className="panel-item"><span className="panel-item-title">Block menu</span><kbd>/</kbd></div>
        <div className="panel-item"><span className="panel-item-title">Bold / italic</span><kbd>Ctrl / ⌘ B · I</kbd></div>
      </div>
    </Modal>}

    {dialog === "settings" && <SettingsDialog onClose={closeDialog} />}

    {moving && <Modal title="Move to" onClose={() => setMoving(null)}>
      <MovePicker pages={pages} pageId={moving} busy={actionBusy} onMove={(parentId) => void commitMove(parentId)} />
    </Modal>}

    {rowMenu && (() => {
      const target = pages.find((item) => item.id === rowMenu.id);
      return target ? <PageMenu
        page={{ title: target.title, favorite: target.favorite }}
        anchor={rowMenu.anchor}
        onPick={(verb) => void runVerb(rowMenu.id, verb)}
        onClose={closeRowMenu}
      /> : null;
    })()}

    {error && <div className="banner" role="alert">
      <span>{error}</span>
      <button className="icon-btn" onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button>
    </div>}
  </div>;
}

/**
 * The `⋯` on a sidebar row (B25).
 *
 * Two call sites — the tree and the favourites shortcuts — and every difference
 * between them was a bug waiting to happen, so it is one component taking the rect
 * the caller's click produced. The rect is read here rather than passed in because
 * the button is the only thing that knows where it is.
 */
function PageOptionsButton({ page, open, onOpen }: {
  page: PageSummary;
  open: boolean;
  onOpen: (id: string, anchor: MenuAnchor) => void;
}) {
  return <button
    className={`tree-more${open ? " is-open" : ""}`}
    title="Page options"
    aria-label={`Page options for ${page.title}`}
    aria-haspopup="menu"
    aria-expanded={open}
    onClick={(event) => onOpen(page.id, atRect(event.currentTarget.getBoundingClientRect()))}
  ><MoreHorizontal size={13} /></button>;
}

/**
 * Inline rename for a sidebar row (B25).
 *
 * A modal for renaming is a dialog around one text field — the row is already the
 * right place, and editing in place keeps the tree still so you can see what you
 * are renaming against its siblings.
 *
 * Uncontrolled on purpose: the input owns its text while it is open, and the
 * commit path is the only thing that writes. `done` guards the double-fire that
 * otherwise happens when Enter commits and the resulting unmount also fires blur.
 */
function RenameField({ title, onCommit, onCancel }: { title: string; onCommit: (title: string) => void; onCancel: () => void }) {
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  const commit = () => { if (done.current) return; done.current = true; onCommit(field.current?.value ?? title); };
  return <input
    ref={field}
    className="tree-rename"
    defaultValue={title}
    maxLength={200}
    aria-label="Page title"
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      if (event.key === "Escape") { event.preventDefault(); done.current = true; onCancel(); }
    }}
    onBlur={commit}
  />;
}

/** The app chrome above the document, shared by the editor and the empty state.
    Two rows when there is a trail to show, one when there is not: `trail` is
    null at the root, and a null row takes no height. */
function TopBar({ strip, onMenu, scrolled = false, trail = null, children }: { strip: ReactNode; onMenu: () => void; scrolled?: boolean; trail?: ReactNode; children?: ReactNode }) {
  return (
    <header className={`topbar${scrolled ? " is-scrolled" : ""}`}>
      <div className="topbar-row">
        <button className="icon-btn mobile-only" onClick={onMenu} aria-label="Open sidebar"><Menu size={17} /></button>
        {strip}
        {children}
      </div>
      {trail}
    </header>
  );
}

function EmptyShell({ strip, onMenu, busy, onCreate, disabled }: { strip: ReactNode; onMenu: () => void; busy: boolean; onCreate: () => void; disabled: boolean }) {
  return <>
    <TopBar strip={strip} onMenu={onMenu} />
    {busy
      ? <div className="empty"><LoaderCircle className="spin" size={18} /><p>Loading…</p></div>
      : <div className="empty">
        <BookOpen size={22} strokeWidth={1.5} />
        <h1>Nothing here yet</h1>
        <p>Start a page and it saves as you type.</p>
        <button className="btn-primary" onClick={onCreate} disabled={disabled}><Plus size={15} />New page</button>
      </div>}
  </>;
}

function PageEditor({ page, pages, theme, strip, onSaved, onTitleDraft, onMenu, onCreated, onOpenPage, onPagesChanged, onRemoved, onError }: {
  page: Page; pages: PageSummary[]; theme: Theme; strip: ReactNode; onSaved: (page: Page) => void;
  onTitleDraft: (id: string, title: string) => void;
  onMenu: () => void; onCreated: (page: Page) => Promise<void>; onOpenPage: (id: string, mode?: "replace" | "append") => Promise<void>; onPagesChanged: () => Promise<unknown>;
  onRemoved: (id: string) => Promise<void>; onError: (message: string) => void;
}) {
  const { draft, status, message, update, flush, persisted, contentVersion, replaceDraft, clearRecovery, rememberScroll, scrollTop } = usePageDraft(page, onSaved);
  const [menu, setMenu] = useState(false), [iconMenu, setIconMenu] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [revisions, setRevisions] = useState<Revision[]>([]), [actionBusy, setActionBusy] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const titleRef = useRef<HTMLTextAreaElement>(null), menuRef = useRef<HTMLDivElement>(null), iconRef = useRef<HTMLDivElement>(null), scrollRef = useRef<HTMLDivElement>(null);
  // Captured once: scroll position belongs to the tab, and this mount is what
  // restores it after a switch.
  const initialScroll = useRef(scrollTop);
  useEffect(() => { const title = titleRef.current; if (title) { title.style.height = "auto"; title.style.height = `${title.scrollHeight}px`; } }, [draft.title]);
  useEffect(() => {
    const title = titleRef.current; if (!title) return;
    let width = -1;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width; title.style.height = "auto"; title.style.height = `${title.scrollHeight}px`;
    });
    observer.observe(title); return () => observer.disconnect();
  }, []);
  // The topbar fades its edge in rather than drawing a rule; that only reads as
  // intentional if it knows whether the document has scrolled under it.
  useEffect(() => {
    const node = scrollRef.current; if (!node) return;
    // Restore before the user can see the top of the page they were halfway down.
    if (initialScroll.current) node.scrollTop = initialScroll.current;
    const onScroll = () => {
      setScrolled(node.scrollTop > 4);
      rememberScroll(node.scrollTop);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [rememberScroll]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); if (!iconRef.current?.contains(event.target as Node)) setIconMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(false); setIconMenu(false); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);
  const exportPage = () => { download(`${draft.title.replace(/[<>:"/\\|?*]/g, "-") || "Untitled"}.md`, `# ${draft.title}\n\n${toMarkdown(draft.content)}\n`, "text/markdown"); setMenu(false); };
  const duplicate = async () => {
    if (!(await flush())) return; setActionBusy(true);
    try { const { page: created } = await request<{ page: Page }>("/api/pages", { method: "POST", body: JSON.stringify({ title: copyTitle(draft.title, pages.map((item) => item.title)), icon: draft.icon, parentId: page.parentId, content: copyBlocks(draft.content), mutationId: crypto.randomUUID() }) }); await onCreated(created); }
    catch (cause) { onError((cause as Error).message); } finally { setActionBusy(false); setMenu(false); }
  };
  const remove = async () => {
    if (!(await flush())) return;
    if (!confirm("Move this page and its subpages to trash? You can restore them later.")) return;
    setActionBusy(true);
    try { await request(`/api/pages/${page.id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: persisted.revision }) }); clearRecovery(); await onRemoved(page.id); }
    catch (cause) { onError((cause as Error).message); } finally { setActionBusy(false); }
  };
  const history = async () => { if (!(await flush())) return; try { setRevisions((await request<{ revisions: Revision[] }>(`/api/pages/${page.id}/history`)).revisions); setHistoryOpen(true); setMenu(false); } catch (cause) { onError((cause as Error).message); } };
  const restoreRevision = async (version: number) => {
    setActionBusy(true);
    try { const { page: prior } = await request<{ page: Page }>(`/api/pages/${page.id}/history?revision=${version}`); replaceDraft({ title: prior.title, content: prior.content, icon: prior.icon }); if (await flush()) setHistoryOpen(false); }
    catch (cause) { onError((cause as Error).message); } finally { setActionBusy(false); }
  };

  const saveLabel = status === "saved" ? "Saved" : status === "saving" ? "Saving…" : status === "pending" ? "Unsaved" : status === "conflict" ? "Conflict" : status === "stale" ? "Changed elsewhere" : "Not saved";
  const words = wordCount(draft.content);

  return <>
    <TopBar
      strip={strip}
      onMenu={onMenu}
      scrolled={scrolled}
      trail={<Crumbs pageId={page.id} pages={pages} onOpen={onOpenPage} />}
    >
      <span className={`save-state is-${status}`} aria-live="polite" title={message || undefined}>
        <span className="save-dot" />{saveLabel}
      </span>
      <button
        className={`icon-btn ${draft.favorite ? "is-on" : ""}`}
        aria-label={draft.favorite ? "Remove from favourites" : "Add to favourites"}
        title={draft.favorite ? "Remove from favourites" : "Add to favourites"}
        aria-pressed={draft.favorite}
        onClick={() => update({ favorite: !draft.favorite })}
      ><Star size={15} fill={draft.favorite ? "currentColor" : "none"} /></button>
      <div className="anchor" ref={menuRef}>
        <button className="icon-btn" aria-label="Page actions" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)}><MoreHorizontal size={17} /></button>
        {menu && <div className="dropdown" role="menu">
          <div className="menu-label">This page</div>
          <button className="menu-item" onClick={exportPage}><ArrowDownToLine size={15} />Export Markdown</button>
          <button className="menu-item" onClick={() => void duplicate()} disabled={actionBusy}><Copy size={15} />Duplicate</button>
          <button className="menu-item" onClick={() => void history()}><Clock3 size={15} />Version history</button>
          <div className="menu-rule" />
          <button className="menu-item is-danger" onClick={() => void remove()} disabled={actionBusy}><Trash2 size={15} />Move to trash</button>
        </div>}
      </div>
    </TopBar>

    <div className="scroll" ref={scrollRef}>
      <article className="doc">
        <div className="anchor" ref={iconRef} style={{ width: "fit-content" }}>
          <button className="doc-icon" title="Change page icon" aria-label="Change page icon" onClick={() => setIconMenu(!iconMenu)}>
            <PageGlyph icon={draft.icon} size={18} />
          </button>
          {iconMenu && <div className="dropdown" role="menu">
            {PAGE_ICONS.map((icon) => <button
              key={icon} className={`menu-item ${draft.icon === icon ? "is-active" : ""}`}
              aria-label={`Use ${icon} icon`} onClick={() => { update({ icon }); setIconMenu(false); }}
            ><PageGlyph icon={icon} size={16} />{icon}</button>)}
          </div>}
        </div>

        <textarea
          ref={titleRef} className="doc-title" rows={1} aria-label="Page title" placeholder="Untitled"
          maxLength={200} value={draft.title}
          onChange={(event) => update({ title: event.target.value.replace(/\n/g, " ") })}
          onInput={(event) => onTitleDraft(page.id, event.currentTarget.value.replace(/\n/g, " "))}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); document.querySelector<HTMLElement>(".bn-editor[contenteditable=true]")?.focus(); }
          }}
        />

        <div className="doc-meta">
          <span>{words === 1 ? "1 word" : `${words} words`}</span>
          <span className="dot" />
          <span>Edited {new Date(page.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        </div>

        {(status === "error" || status === "conflict" || status === "stale") && <div className="doc-alert" role="alert">
          <p>{message}</p>
          <div>
            <button className="btn-ghost" onClick={exportPage}><ArrowDownToLine size={13} />Download draft</button>
            {status === "error"
              ? <button className="btn-ghost" onClick={() => void flush()}>Retry save</button>
              : <button className="btn-ghost" onClick={() => { if (confirm("Replace this unsaved draft with the saved page? Download your draft first if you want to keep it.")) { clearRecovery(); location.reload(); } }}>Load saved version</button>}
          </div>
        </div>}

        <div className="doc-body">
          <BlockEditor
            key={contentVersion} theme={theme}
            initialContent={draft.content}
            onChange={(content) => update({ content })}
            bridge={{ pageId: page.id, pages, onOpenPage, onPagesChanged, onError }}
          />
        </div>
      </article>
    </div>

    {historyOpen && <Modal title="Version history" onClose={closeHistory}>
      <div className="panel-list">
        {revisions.map((revision, index) => <div className="panel-item" key={revision.revision}>
          <Clock3 size={15} />
          <span className="panel-item-title">{revision.title}</span>
          <span className="panel-item-meta">{new Date(revision.createdAt).toLocaleString()}</span>
          {index === 0
            ? <span className="pill">Current</span>
            : <button className="btn-ghost" disabled={actionBusy} onClick={() => void restoreRevision(revision.revision)}><Undo2 size={13} />Restore</button>}
        </div>)}
      </div>
      <div className="panel-foot">Restoring keeps the current version in history.</div>
    </Modal>}
  </>;
}
