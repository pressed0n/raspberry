"use client";
import { type PartialBlock } from "@blocknote/core";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { GridSuggestionMenuController, SuggestionMenuController, getDefaultReactSlashMenuItems, getDefaultReactEmojiPickerItems, useCreateBlockNote, SideMenuController, SideMenu, type SideMenuProps, type DefaultReactSuggestionItem } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Columns3, Database as DatabaseIcon, FilePlus2, FileText, Link2, LoaderCircle, MessageSquareQuote, Search } from "lucide-react";
import { createCallout, createColumns, createPageLink, editorDocument, type DocumentBlock, type Page, type PageSummary } from "@/lib/document";
import { request } from "@/lib/api-client";
import { EditorBridgeContext, EmojiChooser, raspberrySchema as schema, type EditorBridge } from "./editor/schema";
import { EditorDialog } from "./editor/dialog";
import { uploadFileUrl } from "./editor/media";
import { imagePasteHandler, installImageDrop } from "./editor/paste-images";
import { ObjectMenu } from "./editor/object-menu";
import { ObjectSelectionProvider } from "./editor/object-selection";

type SideMenuFloatingOptions = NonNullable<ComponentProps<typeof SideMenuController>["floatingUIOptions"]>;
type SideMenuMiddleware = NonNullable<NonNullable<SideMenuFloatingOptions["useFloatingOptions"]>["middleware"]>[number];

/* The plus and the six dots stay BlockNote's; only the menu behind the dots is
   ours. Declared at module scope on purpose — `SideMenuController` renders this
   by reference, so a fresh component identity per render would remount the menu
   (and re-run its select-on-open effect) on every keystroke elsewhere. */
const RaspberrySideMenu = (_props: SideMenuProps) => <SideMenu dragHandleMenu={ObjectMenu} />;

/**
 * BlockNote centres the block handle on the "first line" of the hovered block
 * using three hardcoded offsets that describe *its own* heading scale (39, 27
 * and 18.5px). This build sets headings from `--fs-h*`, so those offsets pushed
 * the handle a whole line below every heading — the plus and the drag dots sat
 * on the paragraph underneath. Measure the real first line instead: keep the
 * handle inside the first line box and centre it on it.
 */
const firstLineAlignment: SideMenuMiddleware = {
  name: "raspberry-first-line",
  fn: ({ elements, y }) => {
    // Floating UI gets a virtual reference (a rect plus `contextElement`), not
    // the node itself, so the block is reached through `contextElement`.
    const reference = elements.reference as unknown as { contextElement?: Element; element?: Element };
    const element = (reference.contextElement ?? reference.element ?? null) as HTMLElement | null;
    const content = (typeof element?.querySelector === "function" ? element.querySelector(".bn-block-content") : null) as HTMLElement | null;
    if (!content) return {};
    const line = (content.querySelector(".bn-inline-content") as HTMLElement | null) ?? content;
    const lineHeight = Number.parseFloat(getComputedStyle(line).lineHeight) || 0;
    const paddingTop = Number.parseFloat(getComputedStyle(content).paddingTop) || 0;
    const menuHeight = elements.floating?.getBoundingClientRect().height || 30;
    return { y: y + paddingTop + Math.max(0, (lineHeight - menuHeight) / 2) };
  },
};

export default function BlockEditor({ initialContent, onChange, bridge, theme }: { initialContent: DocumentBlock[]; onChange: (content: DocumentBlock[]) => void; bridge: EditorBridge; theme: "dark" | "light" }) {
  const change = useRef(onChange); change.current = onChange;
  const actions = useRef(bridge); actions.current = bridge;
  const initial = useRef(editorDocument(initialContent));
  const [pickerAnchor, setPickerAnchor] = useState<string | null>(null), [creating, setCreating] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState("Creating page…");
  const [emojiBlock, setEmojiBlock] = useState<string | null>(null);
  const alive = useRef(true), childRequest = useRef<{ anchor: string; mutationId: string } | null>(null);
  const databaseRequest = useRef<{ anchor: string; mutationId: string } | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const editor = useCreateBlockNote({ schema, initialContent: initial.current as PartialBlock<typeof schema.blockSchema>[], placeholders: { default: "Write something, or press '/' for commands…" }, uploadFile: uploadFileUrl, pasteHandler: imagePasteHandler() });
  useEffect(() => {
    if (creating || pickerAnchor || emojiBlock || !restoreFocus.current) return;
    const frame = requestAnimationFrame(() => { if (alive.current) editor.focus(); restoreFocus.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [editor, creating, pickerAnchor, emojiBlock]);
  // BlockNote draws the block handle as a portal pinned to the hovered block at
  // a hardcoded vertical offset per block type, and it keeps the handle alive
  // while the pointer travels towards it. Two consequences on a callout: the
  // handle lands on top of the callout emoji, and it reappears as soon as the
  // pointer reaches the icon. Notion withholds the handle from a callout's first
  // object entirely; do the same, and treat the emoji gutter as part of it.
  const floatingOptions = useMemo<SideMenuFloatingOptions>(() => ({ useFloatingOptions: { middleware: [firstLineAlignment] } }), []);
  useEffect(() => {
    const dom = editor.domElement;
    if (!dom) return;
    const root = (dom.closest(".bn-container") ?? dom) as HTMLElement;
    let suppressed = false;
    const apply = (next: boolean) => {
      if (next === suppressed) return;
      suppressed = next;
      root.classList.toggle("menu-suppressed", next);
    };
    const onPointerOver = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".callout-controls")) { apply(true); return; }
      const outer = target?.closest(".bn-block-outer");
      const body = outer?.closest(".callout-body");
      apply(Boolean(outer && body && body.querySelector(".bn-block-outer") === outer));
    };
    dom.addEventListener("pointerover", onPointerOver, true);
    return () => {
      dom.removeEventListener("pointerover", onPointerOver, true);
      root.classList.remove("menu-suppressed");
    };
  }, [editor]);
  // Dragging an image in from a web page carries the same html+Files payload as
  // copying one, so BlockNote hotlinked it exactly as the paste path did. See
  // ./editor/paste-images.ts.
  useEffect(() => installImageDrop(editor), [editor]);
  // Enter in an empty *nested* list item should climb one level and stay a list
  // item. BlockNote's own order resets the empty item to a paragraph first and
  // only then outdents, so the marker vanished while the indent stayed — an
  // unmarked paragraph hanging inside a list. Outdent first; the reset still
  // happens at the top level, where there is nothing to climb out of.
  useEffect(() => {
    const dom = editor.domElement;
    if (!dom) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      if (!editor.isEditable) return;
      let block: { type: string; content?: unknown };
      try { block = editor.getTextCursorPosition().block; } catch { return; }
      if (block.type !== "bulletListItem" && block.type !== "numberedListItem" && block.type !== "checkListItem") return;
      const text = Array.isArray(block.content)
        ? block.content.map((item) => (typeof item === "string" ? item : (item as { text?: string }).text ?? "")).join("")
        : "";
      if (text.trim() !== "") return;
      const anchor = window.getSelection()?.anchorNode;
      const element = anchor ? (anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement) : null;
      const outer = element?.closest(".bn-block-outer");
      if (!outer?.parentElement?.closest(".bn-block-outer")) return;
      if (!editor.canUnnestBlock()) return;
      event.preventDefault();
      event.stopPropagation();
      editor.unnestBlock();
    };
    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  // Keep the live editor uncontrolled. Recovery/history explicitly remount it;
  // feeding each autosave snapshot back would disrupt selection and slash menus.
  const insert = (block: DocumentBlock, anchor?: string) => {
    if (anchor && editor.getBlock(anchor)) editor.setTextCursorPosition(anchor, "end");
    insertOrUpdateBlockForSlashMenu(editor, block as PartialBlock<typeof schema.blockSchema>);
    restoreFocus.current = true;
    editor.focus();
  };
  const createPage = async () => {
    if (creating) return;
    childRequest.current ??= { anchor: editor.getTextCursorPosition().block.id, mutationId: crypto.randomUUID() };
    const pending = childRequest.current; setCreating(true);
    try {
      const { page } = await request<{ page: Page }>("/api/pages", { method: "POST", body: JSON.stringify({ title: "Untitled", parentId: actions.current.pageId, linkInParent: false, mutationId: pending.mutationId }) });
      await actions.current.onPagesChanged();
      if (alive.current) { insert(createPageLink(page, "child"), pending.anchor); childRequest.current = null; }
    } catch (error) { actions.current.onError(error instanceof Error ? error.message : "Unable to create a page. Choose Page again to retry."); }
    finally { if (alive.current) setCreating(false); }
  };
  /* A database is created before its block exists, never after.
     -----------------------------------------------------------------------
     The block's only prop that matters is a `databaseId`, and `documentSchema`
     validates it as a UUID — so the server has to answer first. Inserting a block
     with an empty id and filling it in later would put an invalid block in the
     document for as long as the request takes, and a save in that window would be
     rejected. `mutationId` is kept in a ref so "choose Database again" after a
     network failure retries the same creation instead of leaving an orphan. */
  const createDatabase = async () => {
    if (creating) return;
    databaseRequest.current ??= { anchor: editor.getTextCursorPosition().block.id, mutationId: crypto.randomUUID() };
    const pending = databaseRequest.current;
    setCreatingLabel("Creating database…"); setCreating(true);
    try {
      const { database } = await request<{ database: { id: string; title: string } }>("/api/databases", {
        method: "POST",
        body: JSON.stringify({ pageId: actions.current.pageId, title: "Untitled database", mutationId: pending.mutationId }),
      });
      if (alive.current) {
        insert({ id: crypto.randomUUID(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] }, pending.anchor);
        databaseRequest.current = null;
      }
    } catch (error) { actions.current.onError(error instanceof Error ? error.message : "Unable to create a database. Choose Database again to retry."); }
    finally { if (alive.current) setCreating(false); }
  };
  const items = (): DefaultReactSuggestionItem[] => [
    // Quote text is italic because the author asked for it, not because a
    // stylesheet says so. A CSS italic cannot be turned off with Ctrl+I and the
    // formatting toolbar would claim it was off while the screen showed it on.
    ...getDefaultReactSlashMenuItems(editor).map((item) =>
      item.aliases?.includes("quote")
        ? {
            ...item,
            onItemClick: () => {
              item.onItemClick?.();
              try { editor.toggleStyles({ italic: true }); } catch { /* empty block, nothing to style */ }
            },
          }
        : item,
    ),
    { title: "Database", subtext: "A table you can add properties and views to", group: "Raspberry blocks", aliases: ["database", "table", "db", "view"], icon: <DatabaseIcon size={18} />, onItemClick: () => void createDatabase() },
    { title: "Callout", subtext: "A colored frame with an emoji and nested blocks", group: "Raspberry blocks", aliases: ["callout", "note", "alert", "frame"], icon: <MessageSquareQuote size={18} />, onItemClick: () => insert(createCallout()) },
    { title: "Page", subtext: "Create an empty child page here", group: "Raspberry blocks", aliases: ["page", "subpage", "new page"], icon: <FilePlus2 size={18} />, onItemClick: () => void createPage() },
    { title: "Link to page", subtext: "Link to an existing page without moving it", group: "Raspberry blocks", aliases: ["link to page", "existing page", "page link"], icon: <Link2 size={18} />, onItemClick: () => setPickerAnchor(editor.getTextCursorPosition().block.id) },
    ...[2, 3, 4, 5].map((count) => ({ title: `${count} columns`, subtext: `Arrange blocks in ${count} columns`, group: "Columns", aliases: [`${count} columns`, `columns ${count}`, `column ${count}`, `col${count}`], icon: <Columns3 size={18} />, onItemClick: () => insert(createColumns(count)) })),
  ];
  return <ObjectSelectionProvider editor={editor}><EditorBridgeContext.Provider value={{ ...bridge, onChooseEmoji: setEmojiBlock }}>{creating && <div className="editor-operation" role="status"><LoaderCircle size={14} className="spin" />{creatingLabel}</div>}<BlockNoteView editor={editor} editable={!creating} theme={theme} slashMenu={false} emojiPicker={false} sideMenu={false} onChange={() => change.current(editor.document as DocumentBlock[])}>
    <SideMenuController floatingUIOptions={floatingOptions} sideMenu={RaspberrySideMenu} />
    <SuggestionMenuController triggerCharacter="/" shouldOpen={(state) => !state.selection.$from.parent.type.isInGroup("tableContent")} getItems={async (query) => filterSuggestionItems(items(), query)} />
    <GridSuggestionMenuController triggerCharacter=":" columns={8} minQueryLength={0} getItems={async (query) => (await getDefaultReactEmojiPickerItems(editor, query)).slice(0, 96)} />
  </BlockNoteView>{pickerAnchor && <PagePicker onClose={() => { restoreFocus.current = true; setPickerAnchor(null); }} onSelect={(page) => { insert(createPageLink(page), pickerAnchor); setPickerAnchor(null); }} />}{emojiBlock && <EmojiChooser editor={editor} onClose={() => { restoreFocus.current = true; setEmojiBlock(null); }} onSelect={(emoji) => { if (editor.getBlock(emojiBlock)) editor.updateBlock(emojiBlock, { type: "callout", props: { emoji } }); restoreFocus.current = true; setEmojiBlock(null); }} />}</EditorBridgeContext.Provider></ObjectSelectionProvider>;
}

function PagePicker({ onClose, onSelect }: { onClose: () => void; onSelect: (page: PageSummary) => void }) {
  const [query, setQuery] = useState(""), [pages, setPages] = useState<PageSummary[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    const timeout = setTimeout(() => { void request<{ pages: PageSummary[] }>(`/api/pages?q=${encodeURIComponent(query)}`, { signal: controller.signal }).then((result) => { setPages(result.pages); setError(""); }).catch((cause) => { if (cause.name !== "AbortError") setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 120);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [query]);
  return <EditorDialog title="Link to an existing page" onClose={onClose}><div className="editor-picker-search"><Search size={18} /><input aria-label="Find a page to link" placeholder="Search your pages…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="page-picker-results">{loading ? <div className="dialog-empty"><LoaderCircle className="spin" size={20} /></div> : error ? <p role="alert" className="dialog-description">{error}</p> : pages.length ? pages.map((page) => <button key={page.id} onClick={() => onSelect(page)}><FileText size={18} /><span>{page.title}</span></button>) : <div className="dialog-empty">No pages match your search.</div>}</div><div className="dialog-footer">The page stays in its current location.</div></EditorDialog>;
}
