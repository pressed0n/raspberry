"use client";
/* Raspberry — the object menu that hangs off the six-dot grip (B35, two anchors
   in B36)
   ---------------------------------------------------------------------------
   BlockNote only ships two verbs here (Delete, Colors). This replaces the menu
   wholesale, which is supported: `SideMenu` takes a `dragHandleMenu` component
   and renders it inside its own floating root, so dismissal, positioning and the
   side-menu freeze all stay BlockNote's problem.

   The one thing BlockNote does not do on its own is *select* the block you are
   pointing at — its grip is a menu trigger and a drag source, nothing more. So
   the menu selects on press, which is what makes Ctrl+C work: the clipboard
   reads the selection this menu hands to the store.

   There are two anchors, and they exist because they have to:

     - a normal block is served by BlockNote's floating handle, which follows the
       hovered block (`ObjectMenu`);
     - a layout frame — today the callout — is not. `layoutOnly` frames are
       tracked by the side menu only when the pointer is over the frame's own
       padding, and the editor deliberately suppresses the handle over a callout's
       emoji gutter and its first object (see block-editor.tsx). Hovering a
       callout's text therefore offered no way to select the callout at all, so
       the frame carries its own grip (`FrameMenu`) and its own positioning.

   The body below is shared, so the verbs cannot drift apart. */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { DragHandleMenu, useBlockNoteEditor, useExtensionState } from "@blocknote/react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import type { BlockNoteEditor } from "@blocknote/core";
import { FrameAnchor } from "@/components/frame-anchor";
import { ChevronRight, Code, Copy, Heading1, Heading2, Heading3, List, ListChecks, ListOrdered, Palette, Quote, Repeat2, Trash2, Type } from "lucide-react";
import { COLOR_NAMES, COLOR_LABELS } from "@/lib/palette";
import { useObjectSelection } from "./object-selection";
import {
  currentTurnIntoId,
  deleteBlocks,
  duplicateBlocks,
  targetBlocks,
  turnIntoBlock,
  turnIntoTargets,
  type AnyBlock,
} from "./selection";

type Part = "background" | "text";
type Panel = "none" | "color" | "turn";

/* One glyph per conversion, so the list can be scanned without reading nine
   labels. Chosen once here rather than derived from the block type, because
   "Heading 1" and "Heading 2" share a type and differ only in props. */
const TURN_GLYPHS: Record<string, typeof Type> = {
  paragraph: Type,
  "heading-1": Heading1,
  "heading-2": Heading2,
  "heading-3": Heading3,
  bullet: List,
  numbered: ListOrdered,
  check: ListChecks,
  quote: Quote,
  code: Code,
};

function TurnGlyph({ id }: { id: string }) {
  const Glyph = TURN_GLYPHS[id] ?? Type;
  return <Glyph size={14} aria-hidden />;
}

/** The colour a block currently carries for one part, or "default". */
function partValue(block: AnyBlock, part: Part): string {
  const props = (block.props ?? {}) as Record<string, unknown>;
  const raw = part === "background" ? props.backgroundColor : props.textColor;
  return typeof raw === "string" && raw.length > 0 ? raw : "default";
}

/* ------------------------------------------------------------------ the body */

type MenuProps = {
  editor: BlockNoteEditor<any, any, any>;
  block: AnyBlock;
  targets: AnyBlock[];
  /** Called after a verb runs, so an inline anchor can close itself. The floating
   *  popover does not need this — Mantine closes it on the item click anyway. */
  onDone?: () => void;
};

function ObjectMenuBody({ editor, block, targets, onDone }: MenuProps) {
  const [panel, setPanel] = useState<Panel>("none");
  const [part, setPart] = useState<Part>("background");
  const rootRef = useRef<HTMLDivElement>(null);
  const colorPanelId = useId();
  const turnPanelId = useId();
  const selection = useObjectSelection();

  const run = useCallback(
    (verb: (blocks: AnyBlock[]) => void) => {
      if (targets.length === 0) return;
      verb(targets);
      onDone?.();
    },
    [targets, onDone],
  );

  const duplicate = useCallback(() => {
    if (targets.length === 0) return;
    const copies = duplicateBlocks(editor, targets);
    if (copies.length && selection) selection.select(copies.map((copy) => copy.id));
    onDone?.();
  }, [editor, targets, selection, onDone]);

  /* Roving arrow keys. Mantine's own menu handles this for `Menu.Item`s, and we
     are not using those, so a plain container would leave the arrow keys dead in
     a surface that looks like every other menu on the machine. Panels are skipped
     while shut because a collapsed disclosure still holds its own buttons. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])]
      .filter((element) => element.offsetParent !== null);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = index < 0 ? 0 : (index + step + items.length) % items.length;
      items[next].focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? items[0] : items[items.length - 1]).focus();
    }
  };

  const convertible = turnIntoTargets(block);
  const activeTurnInto = currentTurnIntoId(block);

  return (
    <div className="obj-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        aria-expanded={panel === "color"}
        aria-controls={colorPanelId}
        onClick={() => setPanel(panel === "color" ? "none" : "color")}
      >
        <Palette size={16} aria-hidden />
        <span className="obj-label">Color</span>
        <ChevronRight size={14} aria-hidden className={`obj-chevron${panel === "color" ? " is-open" : ""}`} />
      </button>

      <div id={colorPanelId} role="group" aria-label="Block colour" hidden={panel !== "color"} className="obj-panel">
        <div className="obj-panel-head">
          <div className="obj-segmented" role="group" aria-label="Which part">
            <button type="button" className={part === "background" ? "is-on" : ""} aria-pressed={part === "background"} onClick={() => setPart("background")}>Fill</button>
            <button type="button" className={part === "text" ? "is-on" : ""} aria-pressed={part === "text"} onClick={() => setPart("text")}>Text</button>
          </div>
          <button
            type="button"
            className="obj-reset"
            onClick={() => {
              for (const target of targets) editor.updateBlock(target.id, { props: { [part === "background" ? "backgroundColor" : "textColor"]: "default" } });
            }}
            disabled={targets.every((target) => partValue(target, part) === "default")}
          >
            Reset
          </button>
        </div>
        <div className="swatches" role="group" aria-label={`${part === "background" ? "Fill" : "Text"} colour`}>
          {COLOR_NAMES.map((name) => {
            const chosen = targets.every((target) => partValue(target, part) === name);
            return (
              <button
                key={name}
                type="button"
                role="menuitemradio"
                aria-checked={chosen}
                aria-label={COLOR_LABELS[name]}
                title={COLOR_LABELS[name]}
                className={`swatch${chosen ? " is-active" : ""}`}
                style={{ ["--swatch" as string]: `var(--palette-${name}-${part})` }}
                onClick={() => {
                  for (const target of targets) editor.updateBlock(target.id, { props: { [part === "background" ? "backgroundColor" : "textColor"]: name } });
                }}
              />
            );
          })}
        </div>
      </div>

      <button type="button" role="menuitem" className="menu-item" onClick={duplicate}>
        <Copy size={16} aria-hidden />
        <span className="obj-label">Duplicate</span>
      </button>

      <button
        type="button"
        role="menuitem"
        className="menu-item"
        aria-expanded={panel === "turn"}
        aria-controls={turnPanelId}
        onClick={() => setPanel(panel === "turn" ? "none" : "turn")}
      >
        <Repeat2 size={16} aria-hidden />
        <span className="obj-label">Turn into</span>
        <ChevronRight size={14} aria-hidden className={`obj-chevron${panel === "turn" ? " is-open" : ""}`} />
      </button>

      <div id={turnPanelId} role="group" aria-label="Turn into" hidden={panel !== "turn"} className="obj-panel obj-turns">
        {convertible.map((target) => (
          <button
            key={target.id}
            type="button"
            role="menuitemradio"
            aria-checked={activeTurnInto === target.id}
            className={`obj-turn${activeTurnInto === target.id ? " is-on" : ""}`}
            disabled={targets.length > 1}
            title={targets.length > 1 ? "Turn into works on one block at a time" : undefined}
            onClick={() => run((blocks) => { for (const each of blocks) turnIntoBlock(editor, each, target); })}
          >
            <TurnGlyph id={target.id} />
            {target.label}
          </button>
        ))}
        {convertible.length === 0 && <p className="obj-note">This block has no text form to convert.</p>}
      </div>

      <button type="button" role="menuitem" className="menu-item is-danger" onClick={() => run((blocks) => deleteBlocks(editor, blocks))}>
        <Trash2 size={16} aria-hidden />
        <span className="obj-label">Delete</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------- BlockNote's floating anchor */

export function ObjectMenu() {
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  }) as AnyBlock | undefined;

  const selection = useObjectSelection();

  /* This component mounts when the *handle* renders, which happens on hover —
     not when the menu opens. So the selection is set from the press on the
     handle instead: the handle is in the DOM for as long as we are mounted, and
     a capture-phase press listener is observable regardless of whether the
     dropdown uses `display`, `visibility` or an off-screen transform to hide
     itself (this build uses more than one, and sniffing them was fragile).

     Registering in capture means the provider's "clear on outside press" runs
     first and this wins, which is the order we want: the press is the gesture
     that selects. */
  useEffect(() => {
    if (!block || !selection) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.('button[aria-label="Open block menu"]')) return;
      if (selection.ids.includes(block.id)) return;
      /* A drag across blocks leaves a real ProseMirror range that this store
         knows nothing about. Adopting it rather than collapsing it is the whole
         reason `targetBlocks` has a middle case: press the grip on a block that
         is part of a range and the range survives, so "Duplicate" or "Delete"
         acts on what the user highlighted, not on whichever block the pointer
         happened to land on. */
      const native = editor.getSelection()?.blocks ?? [];
      if (native.length > 1 && native.some((b) => b.id === block.id)) {
        selection.select(native.map((b) => b.id));
        return;
      }
      selection.select([block.id]);
    };
    // Both events on purpose: `pointerdown` is the semantically right one, but
    // `mousedown` is what a synthesised click (and some assistive tech) delivers,
    // and a selection path that only answers real mice is not a selection path.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [block, selection]);

  const targets = useMemo(
    () => (block ? targetBlocks(editor, block, selection?.ids ?? []) : []),
    [editor, block, selection?.ids],
  );

  if (!block) return null;

  return (
    <DragHandleMenu>
      <ObjectMenuBody editor={editor} block={block} targets={targets} />
    </DragHandleMenu>
  );
}

/* ------------------------------------------------------- a frame's own anchor */

/* The grip and the plus are imported, not redrawn. They used to be defined right
   here, private to this file, which is how the database's row gutter ended up with a
   lucide pair beside them — see `components/grip-glyphs.tsx`. */

/** The grip a layout frame renders for itself. Pressing it is the selection:
 *  BlockNote's handle has no block for a `layoutOnly` frame once the editor
 *  withholds it over the callout gutter, so there is nothing else to press. */
export function FrameMenu({ editor, block }: { editor: BlockNoteEditor<any, any, any>; block: AnyBlock }) {
  const selection = useObjectSelection();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPress = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".obj-menu, .frame-grip")) return;
      setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      anchorRef.current?.querySelector("button")?.focus();
    };
    document.addEventListener("mousedown", onPress, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPress, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const targets = useMemo(() => targetBlocks(editor, block, selection?.ids ?? []), [editor, block, selection?.ids]);

  return (
    <FrameAnchor
      anchorRef={anchorRef}
      addLabel="Add block below"
      addTest="frameAdd"
      onAdd={() => {
        const [inserted] = editor.insertBlocks([{ type: "paragraph", content: [] }], block, "after");
        if (inserted) {
          editor.setTextCursorPosition(inserted, "start");
          editor.focus();
        }
      }}
      gripLabel="Open object menu"
      gripTest="frameGrip"
      gripOpen={open}
      onGrip={() => {
        // Selecting is part of pressing the grip: the menu acts on the selection.
        selection?.select([block.id]);
        setOpen((was) => !was);
      }}
    >
      {open && (
        <div className="frame-menu">
          <ObjectMenuBody
            editor={editor}
            block={block}
            targets={targets}
            onDone={() => {
              setOpen(false);
              // Back to the trigger, like every other menu on the machine. Gone
              // after Delete, hence the optional chain.
              anchorRef.current?.querySelector("button")?.focus();
            }}
          />
        </div>
      )}
    </FrameAnchor>
  );
}
