"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs, getDefaultEmojiPickerItems, type BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { ArrowDown, ArrowUpRight, FileText, Link2, LoaderCircle } from "lucide-react";
import { type Page, type PageSummary } from "@/lib/document";
import { request } from "@/lib/api-client";
import { EditorDialog } from "./dialog";
import { FrameMenu } from "./object-menu";
import { type AnyBlock } from "./selection";
import { createVideoBlock } from "./media-video";
import { DatabaseBlock } from "../database/database-block";

export type EditorBridge = { pageId: string; pages: PageSummary[]; onOpenPage: (id: string) => Promise<void>; onPagesChanged: () => Promise<unknown>; onError: (message: string) => void; onChooseEmoji?: (blockId: string) => void };
/** Longest page title a one-line page reference prints before ellipsising. */
const PAGE_LINK_TITLE_LIMIT = 30;
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
  renderFrame: function CalloutFrame({ block, editor, slotRef }) {
    const bridge = useContext(EditorBridgeContext);
    return (
      <div className="raspberry-callout" style={{ backgroundColor: `var(--bn-colors-highlights-${block.props.backgroundColor}-background, transparent)` }}>
        {/* The gutter carries the callout's own grip: the editor withholds
            BlockNote's handle here (it would sit on the emoji, and Notion does not
            offer one for a callout's first object), which left no way to select
            the callout itself. The grip and the emoji share the first line, so
            nothing about the callout's height depends on which is showing. */}
        <div className="callout-controls" contentEditable={false}>
          <button
            className="callout-emoji"
            aria-label="Change callout emoji"
            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); bridge?.onChooseEmoji?.(block.id); }}
          >
            {block.props.emoji}
          </button>
          <FrameMenu editor={editor as BlockNoteEditor<any, any, any>} block={block as unknown as AnyBlock} />
        </div>
        <div className="callout-body" ref={slotRef} />
      </div>
    );
  },
});
const createColumnBlock = createReactBlockSpec({ type: "column", propSchema: {}, content: "none", layoutOnly: true, placeable: "namedOnly" }, {
  meta: { draggable: false }, experimental_keyboard: { emptyChildEnter: "stay" },
  renderFrame: ({ slotRef }) => <div className="raspberry-column" ref={slotRef} />,
});
const createColumnsBlock = createReactBlockSpec({ type: "columns", propSchema: {}, content: "none", layoutOnly: true, children: { allow: ["column"], min: 2 } }, {
  renderFrame: ({ block, editor, slotRef }) => <div className="raspberry-columns-frame"><div className="raspberry-columns" style={{ gridTemplateColumns: `repeat(${block.children.length}, minmax(0, 1fr))` }} ref={slotRef} /><div contentEditable={false} className="columns-exit"><button onClick={() => { const fullEditor = editor as BlockNoteEditor<any, any, any>; const [paragraph] = fullEditor.insertBlocks([{ type: "paragraph" }], block, "after"); fullEditor.setTextCursorPosition(paragraph, "start"); fullEditor.focus(); }}><ArrowDown size={12} />Write below columns</button></div></div>,
});
/**
 * The database block.
 *
 * `content: "none"` because the block owns no text of its own — it is a reference to
 * a database whose rows live in SQL. The two props are the reference itself; the
 * optional `viewId` is what lets one database be embedded twice showing a different
 * view in each place, rather than being forced to duplicate the data.
 *
 * Deliberately *not* `layoutOnly`: a layout-only spec is injected into the block group
 * with no `.bn-block-outer`, which is fine for a callout but loses the anchor the
 * object-selection machinery (B35) paints a selection ring on.
 *
 * `selectable: false` (B40g, finally honoured in B40i — it was in the config, which
 * BlockNote ignores; see the note on `meta` below) — and `draggable` is left at its
 * default `true`.
 *
 * A database is an atom whose body is full of its own controls, so ProseMirror's
 * `selectClickedNode` resolved every press on the table's *background* — the filler
 * column, the space under the rows — to "the user selected this node" and painted the
 * block-selection ring in the primary colour. That selection then had nothing to clear
 * it (the block's own presses call `preventDefault`, so the caret never moves), so the
 * ring stayed until a reload. It also armed Backspace to delete the whole database.
 *
 * `selectable` is the exact flag ProseMirror gates that on: `NodeSelection.isSelectable`
 * is `spec.selectable !== false`, and both `selectClickedNode` and `selectClickedLeaf`
 * check it. The block is still `draggable`, so its side-menu grip, its drag and the
 * B35 ring are untouched — this only stops a click on the body meaning "selected".
 */
const createDatabaseBlock = createReactBlockSpec(
  { type: "database", propSchema: { databaseId: { default: "" }, viewId: { default: "" } }, content: "none" },
  {
    /* `selectable: false` goes in `meta`, **not** beside `content` above.
       It sat in the config for three rounds and did nothing: BlockNote 0.56 builds the
       ProseMirror node spec as `selectable: implementation.meta.selectable` (see
       `nodeSpec` in `@blocknote/core/dist/blocks-*.js`), reading the *implementation*.
       The config type accepts the key, so it type-checked, read correctly and was inert —
       which is why the ring kept coming back however carefully the press guard was drawn.
       BlockNote then also applies its own `applyNonSelectableBlockFix` to the node view,
       which is the part that stops a click near the block becoming a node selection. */
    meta: { selectable: false },
    render: ({ block }) => <DatabaseBlock props={block.props as unknown as Record<string, unknown>} />,
  },
);

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
    // 30 characters is the length that still reads as a title in a one-line
    // reference. Past that it is a fragment, and the ellipsis was landing far
    // earlier than the space available anyway.
    const label = title.length > PAGE_LINK_TITLE_LIMIT ? `${title.slice(0, PAGE_LINK_TITLE_LIMIT).trimEnd()}…` : title;
    return <div contentEditable={false} className={`page-reference ${unavailable ? "unavailable" : ""}`}><a href={unavailable ? undefined : `#${block.props.pageId}`} aria-disabled={unavailable} title={title} onClick={(event) => { if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); if (!unavailable) void bridge?.onOpenPage(block.props.pageId); } }}><FileText size={19} /><span>{label}</span>{unavailable ? <small>Unavailable or in trash</small> : block.props.relationship === "link" ? <Link2 size={14} /> : <ArrowUpRight size={15} />}</a></div>;
  },
});

export const raspberrySchema = BlockNoteSchema.create({ blockSpecs: {
  paragraph: defaultBlockSpecs.paragraph, heading: defaultBlockSpecs.heading,
  bulletListItem: defaultBlockSpecs.bulletListItem, numberedListItem: defaultBlockSpecs.numberedListItem,
  checkListItem: defaultBlockSpecs.checkListItem, quote: defaultBlockSpecs.quote, codeBlock: defaultBlockSpecs.codeBlock,
  table: defaultBlockSpecs.table, divider: defaultBlockSpecs.divider,
  // Media (B26). Image, audio and file are BlockNote's own blocks — they already
  // do upload, caption, resize and replace well. Video is ours only because the
  // native one cannot render a provider embed (see media-video.tsx).
  image: defaultBlockSpecs.image, audio: defaultBlockSpecs.audio, file: defaultBlockSpecs.file, video: createVideoBlock(),
  callout: createCalloutBlock(), columns: createColumnsBlock(), column: createColumnBlock(), pageLink: createPageLinkBlock(), database: createDatabaseBlock(),
} });
export type RaspberryEditor = typeof raspberrySchema.BlockNoteEditor;
