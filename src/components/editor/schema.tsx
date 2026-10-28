"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs, getDefaultEmojiPickerItems, type BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { ArrowDown, ArrowUpRight, FileText, Link2, LoaderCircle } from "lucide-react";
import { type Page, type PageSummary } from "@/lib/document";
import { request } from "@/lib/api-client";
import { EditorDialog } from "./dialog";

export type EditorBridge = { pageId: string; pages: PageSummary[]; onOpenPage: (id: string) => Promise<void>; onPagesChanged: () => Promise<unknown>; onError: (message: string) => void; onChooseEmoji?: (blockId: string) => void };
export const EditorBridgeContext = createContext<EditorBridge | null>(null);

export function EmojiChooser({ editor, onSelect, onClose }: { editor: BlockNoteEditor<any, any, any>; onSelect: (emoji: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState(""), [emojis, setEmojis] = useState<string[]>([]), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setLoading(true);
    void getDefaultEmojiPickerItems(editor, query).then((items) => { if (active) setEmojis(items.slice(0, 96).map((item) => item.id)); }).catch(() => { if (active) setEmojis([]); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [editor, query]);
  return <EditorDialog title="Choose an emoji" onClose={onClose}><div className="editor-picker-search"><input aria-label="Search emoji" placeholder="Search emoji…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="callout-emoji-grid">{loading ? <div className="dialog-empty"><LoaderCircle size={20} className="spin" /></div> : emojis.length ? emojis.map((emoji) => <button key={emoji} aria-label={`Choose ${emoji}`} onClick={() => onSelect(emoji)}>{emoji}</button>) : <p className="dialog-description">No emoji found. Try another word.</p>}</div></EditorDialog>;
}

const createCalloutBlock = createReactBlockSpec({ type: "callout", propSchema: { emoji: { default: "💡" }, backgroundColor: { default: "yellow" } }, content: "none", layoutOnly: true }, {
  renderFrame: function CalloutFrame({ block, slotRef }) {
    const bridge = useContext(EditorBridgeContext);
    return <div className="raspberry-callout" style={{ backgroundColor: `var(--bn-colors-highlights-${block.props.backgroundColor}-background, transparent)` }}><div className="callout-controls" contentEditable={false}><button className="callout-emoji" aria-label="Change callout emoji" onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); bridge?.onChooseEmoji?.(block.id); }}>{block.props.emoji}</button></div><div className="callout-body" ref={slotRef} /></div>;
  },
});
const createColumnBlock = createReactBlockSpec({ type: "column", propSchema: {}, content: "none", layoutOnly: true, placeable: "namedOnly" }, {
  meta: { draggable: false }, experimental_keyboard: { emptyChildEnter: "stay" },
  renderFrame: ({ slotRef }) => <div className="raspberry-column" ref={slotRef} />,
});
const createColumnsBlock = createReactBlockSpec({ type: "columns", propSchema: {}, content: "none", layoutOnly: true, children: { allow: ["column"], min: 2 } }, {
  renderFrame: ({ block, editor, slotRef }) => <div className="raspberry-columns-frame"><div className="raspberry-columns" style={{ gridTemplateColumns: `repeat(${block.children.length}, minmax(0, 1fr))` }} ref={slotRef} /><div contentEditable={false} className="columns-exit"><button onClick={() => { const fullEditor = editor as BlockNoteEditor<any, any, any>; const [paragraph] = fullEditor.insertBlocks([{ type: "paragraph" }], block, "after"); fullEditor.setTextCursorPosition(paragraph, "start"); fullEditor.focus(); }}><ArrowDown size={12} />Write below columns</button></div></div>,
});
const createPageLinkBlock = createReactBlockSpec({ type: "pageLink", propSchema: { pageId: { default: "" }, title: { default: "Untitled" }, relationship: { default: "link", values: ["child", "link"] as const } }, content: "none" }, {
  render: function PageReference({ block, editor }) {
    const bridge = useContext(EditorBridgeContext);
    const listed = bridge?.pages.find((page) => page.id === block.props.pageId);
    const [resolved, setResolved] = useState<PageSummary | null>(null), [unavailable, setUnavailable] = useState(false);
    useEffect(() => {
      if (listed) { setResolved(listed); setUnavailable(false); return; }
      let active = true;
      void request<{ page: Page }>(`/api/pages/${block.props.pageId}`).then(({ page }) => { if (active) { setResolved(page); setUnavailable(false); } }).catch(() => { if (active) { setResolved(null); setUnavailable(true); } });
      return () => { active = false; };
    }, [block.props.pageId, listed]);
    const title = listed?.title ?? resolved?.title ?? block.props.title;
    useEffect(() => { if (!unavailable && title !== block.props.title && editor.isEditable) editor.updateBlock(block, { props: { title } }); }, [title, unavailable, block.props.title, block.id, editor]);
    return <div contentEditable={false} className={`page-reference ${unavailable ? "unavailable" : ""}`}><a href={unavailable ? undefined : `#${block.props.pageId}`} aria-disabled={unavailable} onClick={(event) => { if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); if (!unavailable) void bridge?.onOpenPage(block.props.pageId); } }}><FileText size={19} /><span>{title}</span>{unavailable ? <small>Unavailable or in trash</small> : block.props.relationship === "link" ? <Link2 size={14} /> : <ArrowUpRight size={15} />}</a></div>;
  },
});

export const raspberrySchema = BlockNoteSchema.create({ blockSpecs: {
  paragraph: defaultBlockSpecs.paragraph, heading: defaultBlockSpecs.heading,
  bulletListItem: defaultBlockSpecs.bulletListItem, numberedListItem: defaultBlockSpecs.numberedListItem,
  checkListItem: defaultBlockSpecs.checkListItem, quote: defaultBlockSpecs.quote, codeBlock: defaultBlockSpecs.codeBlock,
  table: defaultBlockSpecs.table, divider: defaultBlockSpecs.divider,
  callout: createCalloutBlock(), columns: createColumnsBlock(), column: createColumnBlock(), pageLink: createPageLinkBlock(),
} });
export type RaspberryEditor = typeof raspberrySchema.BlockNoteEditor;
