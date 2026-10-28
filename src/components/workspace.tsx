"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, Clock3, Compass, Copy, FileText, HelpCircle, Leaf, Lightbulb, LoaderCircle, Menu, MoreHorizontal, NotebookPen, PanelLeftClose, Plus, Search, Sparkles, Star, Trash2, Undo2, X } from "lucide-react";
import { download, request } from "@/lib/api-client";
import { toMarkdown, wordCount, type Page, type PageIcon, type PageSummary, type Revision } from "@/lib/document";
import { usePageDraft } from "./use-page-draft";
const BlockEditor = dynamic(() => import("./block-editor"), { ssr: false, loading: () => <div className="editor-loading"><LoaderCircle className="spin" size={18} /> Opening your page…</div> });
const icons = { file: FileText, sparkles: Sparkles, notebook: NotebookPen, lightbulb: Lightbulb, compass: Compass, leaf: Leaf };
function PageGlyph({ icon, size = 17 }: { icon: PageIcon; size?: number }) { const Icon = icons[icon] ?? FileText; return <Icon size={size} strokeWidth={1.65} />; }
function RaspberryMark({ small = false }: { small?: boolean }) { return <svg width={small ? 22 : 29} height={small ? 27 : 34} viewBox="0 0 32 38" fill="none" aria-hidden="true"><path d="M15 9C9 9 5 5 5 2c6-1 11 1 11 7M17 9c0-5 4-8 10-7-1 5-5 7-10 7" fill="#53745B" /><g fill="currentColor"><circle cx="10" cy="14" r="6"/><circle cx="22" cy="14" r="6"/><circle cx="6" cy="24" r="5.5"/><circle cx="16" cy="24" r="6"/><circle cx="26" cy="24" r="5.5"/><circle cx="11" cy="32" r="5"/><circle cx="21" cy="32" r="5"/></g></svg>; }
function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, a[href], [tabindex="0"]') ?? []);
    (dialog.current?.querySelector<HTMLInputElement>("input") ?? focusable()[0] ?? dialog.current)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", key); return () => { window.removeEventListener("keydown", key); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`modal ${wide ? "modal-wide" : ""}`}><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>{children}</div></div>;
}

export default function Workspace() {
  const [pages, setPages] = useState<PageSummary[]>([]), [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(false), [dialog, setDialog] = useState<"search" | "trash" | "help" | null>(null);
  const [query, setQuery] = useState(""), [searchResults, setSearchResults] = useState<PageSummary[]>([]), [trash, setTrash] = useState<PageSummary[]>([]);
  const [searchBusy, setSearchBusy] = useState(false), [actionBusy, setActionBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const flush = useRef<(() => Promise<boolean>) | null>(null);
  const closeDialog = useCallback(() => { setDialog(null); setQuery(""); }, []);
  const refresh = useCallback(async () => { const result = await request<{ pages: PageSummary[] }>("/api/pages"); setPages(result.pages); return result.pages; }, []);
  const openPage = useCallback(async (id: string) => {
    if (flush.current && !(await flush.current())) return;
    setBusy(true); setError("");
    try {
      const result = await request<{ page: Page }>(`/api/pages/${id}`);
      setPage(result.page); history.replaceState(null, "", `#${id}`); setSidebar(false); closeDialog();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open page."); }
    finally { setBusy(false); }
  }, [closeDialog]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await refresh(), bookmarked = location.hash.slice(1), id = list.find((p) => p.id === bookmarked)?.id ?? list[0]?.id;
        if (!alive) return;
        if (id) { const result = await request<{ page: Page }>(`/api/pages/${id}`); if (alive) setPage(result.page); }
      } catch (cause) { if (alive) setError(cause instanceof Error ? cause.message : "Unable to load workspace."); }
      finally { if (alive) setBusy(false); }
    })();
    return () => { alive = false; };
  }, [refresh]);
  const create = useCallback(async (parentId: string | null = null) => {
    if (actionBusy || (flush.current && !(await flush.current()))) return;
    setActionBusy(true);
    try {
      const result = await request<{ page: Page }>("/api/pages", { method: "POST", body: JSON.stringify({ title: "Untitled", parentId, mutationId: crypto.randomUUID() }) });
      await refresh(); setPage(result.page); history.replaceState(null, "", `#${result.page.id}`); setSidebar(false); closeDialog();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create page."); }
    finally { setActionBusy(false); }
  }, [actionBusy, refresh, closeDialog]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setDialog((current) => current === "search" ? null : "search"); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void flush.current?.(); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (dialog !== "search") return;
    const controller = new AbortController(); setSearchBusy(true);
    const timeout = setTimeout(() => {
      request<{ pages: PageSummary[] }>(`/api/pages?q=${encodeURIComponent(query)}`, { signal: controller.signal }).then((result) => setSearchResults(result.pages)).catch((cause) => { if (cause.name !== "AbortError") setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setSearchBusy(false); });
    }, 150);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [dialog, query]);
  const openTrash = async () => { try { setTrash((await request<{ pages: PageSummary[] }>("/api/pages?trash=1")).pages); setDialog("trash"); } catch (cause) { setError((cause as Error).message); } };
  const restore = async (id: string) => {
    setActionBusy(true);
    try { await request(`/api/pages/${id}/restore`, { method: "POST" }); await refresh(); setTrash((await request<{ pages: PageSummary[] }>("/api/pages?trash=1")).pages); }
    catch (cause) { setError((cause as Error).message); } finally { setActionBusy(false); }
  };
  const onSaved = useCallback((saved: Page) => { setPages((current) => current.map((item) => item.id === saved.id ? saved : item)); }, []);
  const onRemoved = async () => {
    flush.current = null; setPage(null); const list = await refresh(); if (list[0]) await openPage(list[0].id);
  };
  const tree = (parent: string | null, depth = 0): ReactNode => pages.filter((p) => p.parentId === parent).map((item) => {
    const children = pages.some((p) => p.parentId === item.id);
    return <div key={item.id}><div className={`page-row ${page?.id === item.id ? "active" : ""}`} style={{ paddingLeft: 10 + depth * 15 }}>
      {children ? <button className="tree-toggle" aria-label={`${collapsed.has(item.id) ? "Expand" : "Collapse"} ${item.title}`} onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}>{collapsed.has(item.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button> : <span className="tree-spacer" />}
      <button className="page-link" onClick={() => void openPage(item.id)} disabled={busy}><PageGlyph icon={item.icon} /><span>{item.title}</span></button>
      <button className="row-add" title="Add a subpage" aria-label={`Add subpage to ${item.title}`} onClick={() => void create(item.id)} disabled={actionBusy}><Plus size={14} /></button>
    </div>{children && !collapsed.has(item.id) ? tree(item.id, depth + 1) : null}</div>;
  });
  return <div className="workspace">
    {sidebar && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? "is-open" : ""}`} aria-label="Workspace navigation">
      <div className="workspace-brand"><span className="brand-mark"><RaspberryMark small /></span><strong>Raspberry<span className="brand-period">.</span></strong><button className="mobile-close icon-button" aria-label="Close sidebar" onClick={() => setSidebar(false)}><PanelLeftClose size={17} /></button></div>
      <div className="workspace-name"><span className="workspace-avatar">P</span><div><strong>Personal workspace</strong><span>Room to think.</span></div></div>
      <nav className="primary-nav"><button onClick={() => setDialog("search")}><Search size={17} /><span>Search anything</span><kbd>Ctrl K</kbd></button><button onClick={() => void create()} disabled={actionBusy}><Plus size={18} /><span>New page</span></button></nav>
      {pages.some((p) => p.favorite) && <section className="nav-section"><div className="section-heading">Favorites<Star size={11} /></div>{pages.filter((p) => p.favorite).map((item) => <button key={item.id} className="favorite-link" onClick={() => void openPage(item.id)} disabled={busy}><PageGlyph icon={item.icon} /><span>{item.title}</span></button>)}</section>}
      <section className="nav-section page-section"><div className="section-heading">Your pages<button className="tiny-button" title="New page" aria-label="Create a page" onClick={() => void create()} disabled={actionBusy}><Plus size={15} /></button></div><div className="page-tree">{tree(null)}</div><button className="add-page" onClick={() => void create()} disabled={actionBusy}><Plus size={15} /> Add a page</button></section>
      <div className="sidebar-bottom"><div className="workspace-note"><span className="note-sprout"><Leaf size={20} strokeWidth={1.5}/></span><p>A little more clarity.<br /><strong>A little more possibility.</strong></p></div><button className="utility-link" onClick={() => void openTrash()}><Trash2 size={16} />Trash</button><button className="utility-link" onClick={() => setDialog("help")}><HelpCircle size={16} />Help & shortcuts<ArrowUpRight size={13} className="trailing-icon" /></button><div className="sidebar-footer"><span className="local-dot" />Local workspace<span>v0.1</span></div></div>
    </aside>
    <main className="main-pane">
      {error && <div className="global-error" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
      {page && !busy ? <PageEditor key={page.id} page={page} pages={pages} onSaved={onSaved} registerFlush={(handler) => { flush.current = handler; }} onMenu={() => setSidebar(true)} onNew={() => void create()} onCreated={async (created) => { await refresh(); setPage(created); history.replaceState(null, "", `#${created.id}`); }} onOpenPage={openPage} onPagesChanged={refresh} onRemoved={onRemoved} onError={setError} /> : <><div className="topbar"><button className="icon-button mobile-menu" onClick={() => setSidebar(true)} aria-label="Open sidebar"><Menu size={20} /></button><span className="muted">Personal workspace</span></div><div className="workspace-empty">{busy ? <><LoaderCircle size={25} className="spin" /><p>Making a little room…</p></> : <><span className="empty-mark"><RaspberryMark /></span><h1>A fresh start.</h1><p>Your next idea deserves a page.</p><button className="primary-button" onClick={() => void create()} disabled={actionBusy}><Plus size={16} />Create your first page</button></>}</div></>}
    </main>
    {dialog === "search" && <Modal title="Find a little clarity" onClose={closeDialog} wide><div className="search-field"><Search size={20} /><input autoFocus placeholder="Search your pages and their contents…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search pages" /><kbd>Esc</kbd></div><div className="search-results">{searchBusy ? <div className="dialog-empty"><LoaderCircle size={20} className="spin" /> Searching…</div> : searchResults.length ? searchResults.map((item) => <button key={item.id} onClick={() => void openPage(item.id)}><PageGlyph icon={item.icon} size={20} /><div><strong>{item.title}</strong><span>{item.wordCount} words · {new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div><ArrowUpRight size={15} /></button>) : <div className="dialog-empty"><Search size={25} /><p>No pages found. Try another word.</p></div>}</div><div className="dialog-footer">A place for every thought. A way to find it again.</div></Modal>}
    {dialog === "trash" && <Modal title="Trash" onClose={closeDialog}><p className="dialog-description">A change of mind is always welcome. Restore a page to bring it back.</p><div className="trash-list">{trash.length ? trash.map((item) => <div key={item.id}><PageGlyph icon={item.icon} /><span>{item.title}</span><button className="subtle-button" disabled={actionBusy} onClick={() => void restore(item.id)}><Undo2 size={14} />Restore</button></div>) : <div className="dialog-empty"><Leaf size={28} /><p>All clear. Nothing in the trash.</p></div>}</div></Modal>}
    {dialog === "help" && <Modal title="A few little shortcuts" onClose={closeDialog}><div className="shortcuts"><div><span>Find a page</span><kbd>Ctrl / ⌘ K</kbd></div><div><span>Save now</span><kbd>Ctrl / ⌘ S</kbd></div><div><span>Writing tools</span><kbd>/</kbd></div><div><span>Bold / italic</span><kbd>Ctrl / ⌘ B / I</kbd></div></div><div className="help-note"><BookOpen size={20} /><p>Pages save as you write. Star a favorite to keep it close, or open the page menu for history and export.</p></div></Modal>}
  </div>;
}

function PageEditor({ page, pages, onSaved, registerFlush, onMenu, onNew, onCreated, onOpenPage, onPagesChanged, onRemoved, onError }: {
  page: Page; pages: PageSummary[]; onSaved: (page: Page) => void; registerFlush: (flush: (() => Promise<boolean>) | null) => void;
  onMenu: () => void; onNew: () => void; onCreated: (page: Page) => Promise<void>; onRemoved: () => Promise<void>; onError: (message: string) => void;
  onOpenPage: (id: string) => Promise<void>; onPagesChanged: () => Promise<unknown>;
}) {
  const { draft, status, message, update, flush, persisted, contentVersion, replaceDraft, clearRecovery } = usePageDraft(page, onSaved);
  const [menu, setMenu] = useState(false), [iconMenu, setIconMenu] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [revisions, setRevisions] = useState<Revision[]>([]), [actionBusy, setActionBusy] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const titleRef = useRef<HTMLTextAreaElement>(null), menuRef = useRef<HTMLDivElement>(null), iconRef = useRef<HTMLDivElement>(null);
  useEffect(() => { registerFlush(flush); return () => registerFlush(null); }, [flush, registerFlush]);
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
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); if (!iconRef.current?.contains(event.target as Node)) setIconMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(false); setIconMenu(false); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);
  const exportPage = () => { download(`${draft.title.replace(/[<>:"/\\|?*]/g, "-") || "Untitled"}.md`, `# ${draft.title}\n\n${toMarkdown(draft.content)}\n`, "text/markdown"); setMenu(false); };
  const duplicate = async () => {
    if (!(await flush())) return; setActionBusy(true);
    try { const { page: created } = await request<{ page: Page }>("/api/pages", { method: "POST", body: JSON.stringify({ title: `${draft.title} (copy)`.slice(0, 200), icon: draft.icon, parentId: page.parentId, content: draft.content.map((block) => reidentify(block)), mutationId: crypto.randomUUID() }) }); await onCreated(created); }
    catch (cause) { onError((cause as Error).message); } finally { setActionBusy(false); setMenu(false); }
  };
  const remove = async () => {
    if (!(await flush())) return;
    if (!confirm("Move this page and its subpages to trash? You can restore them later.")) return;
    setActionBusy(true);
    try { await request(`/api/pages/${page.id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: persisted.current.revision }) }); clearRecovery(); await onRemoved(); }
    catch (cause) { onError((cause as Error).message); } finally { setActionBusy(false); }
  };
  const history = async () => { if (!(await flush())) return; try { setRevisions((await request<{ revisions: Revision[] }>(`/api/pages/${page.id}/history`)).revisions); setHistoryOpen(true); setMenu(false); } catch (cause) { onError((cause as Error).message); } };
  const restoreRevision = async (version: number) => {
    setActionBusy(true);
    try { const { page: prior } = await request<{ page: Page }>(`/api/pages/${page.id}/history?revision=${version}`); replaceDraft({ title: prior.title, content: prior.content, icon: prior.icon }); if (await flush()) setHistoryOpen(false); }
    catch (cause) { onError((cause as Error).message); } finally { setActionBusy(false); }
  };
  const parent = pages.find((p) => p.id === page.parentId);
  return <>
    <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" onClick={onMenu} aria-label="Open sidebar"><Menu size={20} /></button><span className="breadcrumb-workspace">Personal workspace</span><ChevronRight size={13} className="breadcrumb-workspace"/>{parent && <><span className="parent-crumb">{parent.title}</span><ChevronRight size={13}/></>}<span className="breadcrumb-page"><PageGlyph icon={draft.icon} size={15} /><span>{draft.title || "Untitled"}</span></span></div><div className="page-tools"><span className={`save-state ${status}`} aria-live="polite">{status === "saving" ? <LoaderCircle size={13} className="spin" /> : status === "saved" ? <Check size={13} /> : null}<span>{status === "saved" ? "All changes saved" : status === "saving" ? "Saving…" : status === "pending" ? "Unsaved changes" : "Draft kept"}</span></span><span className="toolbar-divider"/><button className={`icon-button favorite-toggle ${draft.favorite ? "is-favorite" : ""}`} aria-label={draft.favorite ? "Remove from favorites" : "Add to favorites"} title={draft.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => update({ favorite: !draft.favorite })}><Star size={17} fill={draft.favorite ? "currentColor" : "none"}/></button><div className="menu-anchor" ref={menuRef}><button className="icon-button" aria-label="Page actions" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={21}/></button>{menu && <div className="dropdown page-dropdown"><div className="dropdown-label">THIS PAGE</div><button onClick={exportPage}><ArrowDownToLine size={16}/>Export Markdown</button><button onClick={() => void duplicate()} disabled={actionBusy}><Copy size={16}/>Duplicate page</button><button onClick={() => void history()}><Clock3 size={16}/>Version history</button><div className="dropdown-rule"/><button className="danger" onClick={() => void remove()} disabled={actionBusy}><Trash2 size={16}/>Move to trash</button></div>}</div></div></header>
    <div className="document-scroll"><article className="document"><div className="document-eyebrow"><span className="eyebrow-line"/> YOUR SPACE TO THINK</div><div className="page-icon-wrap" ref={iconRef}><button className={`document-icon icon-${draft.icon}`} title="Change page icon" aria-label="Change page icon" onClick={() => setIconMenu(!iconMenu)}><PageGlyph icon={draft.icon} size={30}/></button>{iconMenu && <div className="dropdown icon-dropdown">{(Object.keys(icons) as PageIcon[]).map((icon) => <button key={icon} aria-label={`Use ${icon} icon`} className={draft.icon === icon ? "selected" : ""} onClick={() => { update({ icon }); setIconMenu(false); }}><PageGlyph icon={icon} size={22}/></button>)}</div>}</div><textarea ref={titleRef} className="page-title" rows={1} aria-label="Page title" placeholder="Untitled" maxLength={200} value={draft.title} onChange={(event) => update({ title: event.target.value.replace(/\n/g, " ") })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); document.querySelector<HTMLElement>(".bn-editor[contenteditable=true]")?.focus(); } }} /><div className="document-meta"><span className="author-avatar">Y</span><span>Your personal space</span><span className="meta-dot">·</span><span>{wordCount(draft.content)} words</span></div><div className="document-rule"/>
      {(status === "error" || status === "conflict") && <div className="draft-alert" role="alert"><p>{message}</p><div><button className="subtle-button" onClick={exportPage}><ArrowDownToLine size={14}/>Download draft</button>{status === "error" ? <button className="subtle-button" onClick={() => void flush()}>Retry save</button> : <button className="subtle-button" onClick={() => { if (confirm("Replace this unsaved draft with the saved page? Download your draft first if you want to keep it.")) { clearRecovery(); location.reload(); } }}>Load saved version</button>}</div></div>}
      <div className="editor-area"><BlockEditor key={contentVersion} initialContent={draft.content} onChange={(content) => update({ content })} bridge={{ pageId: page.id, pages, onOpenPage, onPagesChanged, onError }} /></div><div className="document-bottom"><span><span className="bottom-dot"/>A little progress, saved.</span><button onClick={onNew}><Plus size={14}/>Start another page</button></div></article><footer className="main-footer"><span className="footer-brand"><RaspberryMark small/>raspberry</span><span>Good things grow here.</span></footer></div>
    {historyOpen && <Modal title="Your page, over time" onClose={closeHistory}><p className="dialog-description">Restore an earlier version. Your current version stays in the history.</p><div className="history-list">{revisions.map((revision, index) => <div key={revision.revision}><Clock3 size={17}/><div><strong>{revision.title}</strong><span>{new Date(revision.createdAt).toLocaleString()} · {revision.clientId === "browser" ? "You" : revision.clientId}</span></div>{index === 0 ? <span className="current-badge">Current</span> : <button className="subtle-button" disabled={actionBusy} onClick={() => void restoreRevision(revision.revision)}>Restore</button>}</div>)}</div></Modal>}
  </>;
}
function reidentify(block: Page["content"][number]): Page["content"][number] { return { ...block, id: crypto.randomUUID(), props: block.type === "pageLink" ? { ...block.props, relationship: "link" } : block.props, children: block.children.map(reidentify) }; }
