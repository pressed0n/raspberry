"use client";
import { type PartialBlock } from "@blocknote/core";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { GridSuggestionMenuController, SuggestionMenuController, getDefaultReactSlashMenuItems, getDefaultReactEmojiPickerItems, useCreateBlockNote, type DefaultReactSuggestionItem } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef, useState } from "react";
import { Columns3, FilePlus2, FileText, Link2, LoaderCircle, MessageSquareQuote, Search } from "lucide-react";
import { createCallout, createColumns, createPageLink, editorDocument, type DocumentBlock, type Page, type PageSummary } from "@/lib/document";
import { request } from "@/lib/api-client";
import { EditorBridgeContext, EmojiChooser, raspberrySchema as schema, type EditorBridge } from "./editor/schema";
import { EditorDialog } from "./editor/dialog";

export default function BlockEditor({ initialContent, onChange, bridge }: { initialContent: DocumentBlock[]; onChange: (content: DocumentBlock[]) => void; bridge: EditorBridge }) {
  const change = useRef(onChange); change.current = onChange;
  const actions = useRef(bridge); actions.current = bridge;
  const initial = useRef(editorDocument(initialContent));
  const [pickerAnchor, setPickerAnchor] = useState<string | null>(null), [creating, setCreating] = useState(false);
  const [emojiBlock, setEmojiBlock] = useState<string | null>(null);
  const alive = useRef(true), childRequest = useRef<{ anchor: string; mutationId: string } | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const editor = useCreateBlockNote({ schema, initialContent: initial.current as PartialBlock<typeof schema.blockSchema>[], placeholders: { default: "Write something, or press '/' for commands…" } });
  useEffect(() => {
    if (creating || pickerAnchor || emojiBlock || !restoreFocus.current) return;
    const frame = requestAnimationFrame(() => { if (alive.current) editor.focus(); restoreFocus.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [editor, creating, pickerAnchor, emojiBlock]);
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
  const items = (): DefaultReactSuggestionItem[] => [
    ...getDefaultReactSlashMenuItems(editor),
    { title: "Callout", subtext: "A colored frame with an emoji and nested blocks", group: "Raspberry blocks", aliases: ["callout", "note", "alert", "frame"], icon: <MessageSquareQuote size={18} />, onItemClick: () => insert(createCallout()) },
    { title: "Page", subtext: "Create an empty child page here", group: "Raspberry blocks", aliases: ["page", "subpage", "new page"], icon: <FilePlus2 size={18} />, onItemClick: () => void createPage() },
    { title: "Link to page", subtext: "Link to an existing page without moving it", group: "Raspberry blocks", aliases: ["link to page", "existing page", "page link"], icon: <Link2 size={18} />, onItemClick: () => setPickerAnchor(editor.getTextCursorPosition().block.id) },
    ...[2, 3, 4, 5].map((count) => ({ title: `${count} columns`, subtext: `Arrange blocks in ${count} columns`, group: "Columns", aliases: [`${count} columns`, `columns ${count}`, `column ${count}`, `col${count}`], icon: <Columns3 size={18} />, onItemClick: () => insert(createColumns(count)) })),
  ];
  return <EditorBridgeContext.Provider value={{ ...bridge, onChooseEmoji: setEmojiBlock }}>{creating && <div className="editor-operation" role="status"><LoaderCircle size={14} className="spin" />Creating your page…</div>}<BlockNoteView editor={editor} editable={!creating} theme="light" slashMenu={false} emojiPicker={false} onChange={() => change.current(editor.document as DocumentBlock[])}>
    <SuggestionMenuController triggerCharacter="/" shouldOpen={(state) => !state.selection.$from.parent.type.isInGroup("tableContent")} getItems={async (query) => filterSuggestionItems(items(), query)} />
    <GridSuggestionMenuController triggerCharacter=":" columns={8} minQueryLength={0} getItems={async (query) => (await getDefaultReactEmojiPickerItems(editor, query)).slice(0, 96)} />
  </BlockNoteView>{pickerAnchor && <PagePicker onClose={() => { restoreFocus.current = true; setPickerAnchor(null); }} onSelect={(page) => { insert(createPageLink(page), pickerAnchor); setPickerAnchor(null); }} />}{emojiBlock && <EmojiChooser editor={editor} onClose={() => { restoreFocus.current = true; setEmojiBlock(null); }} onSelect={(emoji) => { if (editor.getBlock(emojiBlock)) editor.updateBlock(emojiBlock, { type: "callout", props: { emoji } }); restoreFocus.current = true; setEmojiBlock(null); }} />}</EditorBridgeContext.Provider>;
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
