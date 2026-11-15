"use client";
/* The formula editor — Notion's big dropdown, rebuilt.
   ---------------------------------------------------------------------------
   One surface, four bands, top to bottom, in the order somebody actually works:

     1. the field          what the formula is, painted, with the caret in it
     2. the preview        what it produces, on a page you choose, and what type
     3. the browser        properties and functions, filtered by the word being typed
     4. the detail         the signature, a sentence, and examples that are *run*

   Four decisions worth the prose.

   **The text is painted, not plain.** A `<pre>` under a transparent `<textarea>` shares
   the field's metrics and its scroll; the colours come from `paintFormula`, which uses
   the parser's own tokenizer. A syntax error is allowed to exist: the panel does not
   refuse a half-typed formula, it shows the sentence at the bottom of the field and
   keeps the table alone until the formula is finished.

   **The list is a suggestion list, not a browser.** It is filtered by the word before
   the caret and it replaces that word when pressed, so the keyboard path is "type three
   letters, Enter" rather than "find it in a list". Typing `prop("` narrows it to
   columns — the one place a formula points at the table, and the one place people go
   looking for a name they cannot quite remember.

   **The examples are executed.** Every example in the detail pane is run against the
   page in the preview, and shows the value that came back. Documentation that drifts
   from the language is therefore impossible to *read* wrong: the help and the answer are
   the same call, and `tests/database-formula.test.ts` fails if they ever disagree.

   **Nothing is written until the surface closes.** `onCommit` runs once, from the same
   place that closes the panel, so a fifty-keystroke edit is one `PATCH` — and the
   preview needs no server round trip at all, because the rows are already in memory.

   The one thing from the screenshots that is deliberately missing is the AI box at the
   top ("Write, fix, or explain a formula…"). This app has no model wired to it, and a
   field that promises a sentence and produces nothing is worse than an absent field.
   --------------------------------------------------------------------------- */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Copy, X } from "lucide-react";
import {
  filterEntries, formulaCatalog, paintFormula, previewFormula, suggestionAt, traceFormula,
  insertEntry, expressionOf, type CatalogEntry,
} from "@/lib/database/formula";
import type { PropertyDef, RowDef } from "@/lib/database/types";
import { MenuItem, MenuSurface, useMenuDismiss } from "./menu";
import { iconNameFor, PropertyIcon } from "./property-icons";

const PANEL_WIDTH = 620;
const PANEL_HEIGHT = 560;

/**
 * Closing, with one write.
 *
 * The handler has to be *stable*: `useMenuDismiss` re-registers its document listeners
 * whenever `onClose` changes, and this panel re-renders on every keystroke — a new
 * function per letter would remove and re-add the outside-press listener sixty times a
 * sentence, with a `setTimeout` between. So the latest values live in a ref and the
 * callback itself never changes identity.
 */
function useCloseOnce(draft: string, original: string, onCommit: (expression: string) => void, onClose: () => void): () => void {
  const latest = useRef({ draft, original, onCommit, onClose });
  latest.current = { draft, original, onCommit, onClose };
  const close = useRef(() => {
    const current = latest.current;
    if (current.draft !== current.original) current.onCommit(current.draft);
    current.onClose();
  }).current;
  return close;
}

export function FormulaPanel({
  anchor, property, properties, rows, onCommit, onClose,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  property: PropertyDef;
  properties: PropertyDef[];
  rows: RowDef[];
  onCommit: (expression: string) => void;
  onClose: () => void;
}) {
  const original = expressionOf(property);
  const [draft, setDraft] = useState(original);
  const [caret, setCaret] = useState(original.length);
  const [rowId, setRowId] = useState(rows[0]?.id ?? "");
  const [debug, setDebug] = useState(false);
  const [help, setHelp] = useState(false);
  const [active, setActive] = useState("");
  const [picker, setPicker] = useState(false);
  /* Whether the person has typed since the panel opened. Opening on an existing formula puts the
     caret at its end, and filtering by "whatever token happens to be there" would open the browser
     on a list narrowed by the last word of a formula nobody is editing — Notion opens on the full
     list, and so does this. The first keystroke starts the narrowing. */
  const [narrowed, setNarrowed] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const paint = useRef<HTMLPreElement | null>(null);
  const pickerAnchor = useRef<HTMLButtonElement | null>(null);
  const [copied, setCopied] = useState("");
  const id = useId();

  /* The field takes the cursor on open and the caret sits at the end of what is already
     there — writing a formula starts where the last one stopped. */
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);

  const close = useCloseOnce(draft, original, onCommit, onClose);
  useMenuDismiss(true, close);

  /* Escape belongs to the page picker while it is open. Both surfaces dismiss on a
     document-level Escape, so without this one press would close the picker *and* the panel —
     the dismiss hook cannot tell which of them the press was aimed at. Capture runs before the
     bubble-phase dismiss listeners, and stopping there means they never hear it. */
  useEffect(() => {
    if (!picker) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPicker(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [picker]);

  const previewRow = rows.find((row) => row.id === rowId) ?? rows[0] ?? null;
  const now = useMemo(() => new Date(), []);

  const sections = useMemo(() => formulaCatalog(properties, property.id), [properties, property.id]);
  const suggestion = useMemo(
    () => (narrowed
      ? suggestionAt(draft, caret)
      : { query: "", start: caret, end: caret, wanted: "any" as const }),
    [narrowed, draft, caret],
  );
  const shown = useMemo(
    () => sections
      .map((section) => ({ ...section, entries: filterEntries(section.entries, suggestion) }))
      .filter((section) => section.entries.length > 0),
    [sections, suggestion],
  );
  const flat = useMemo(() => shown.flatMap((section) => section.entries), [shown]);
  const highlighted = flat.find((entry) => entry.key === active) ?? flat[0] ?? null;

  const result = useMemo(
    () => (previewRow ? previewFormula(draft, previewRow, properties, now) : null),
    [draft, previewRow, properties, now],
  );
  const trace = useMemo(
    () => (debug && previewRow ? traceFormula(draft, previewRow, properties, now) : []),
    [debug, draft, previewRow, properties, now],
  );

  const apply = (entry: CatalogEntry) => {
    const { next, caret: after } = insertEntry(draft, entry, suggestionAt(draft, caret));
    setDraft(next);
    setCaret(after);
    requestAnimationFrame(() => {
      const node = field.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(after, after);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const typing = suggestion.query !== "";
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!flat.length) return;
      event.preventDefault();
      const at = flat.findIndex((entry) => entry.key === highlighted?.key);
      const next = event.key === "ArrowDown" ? (at + 1) % flat.length : at <= 0 ? flat.length - 1 : at - 1;
      setActive(flat[next].key);
      /* Keep the highlighted row in view without moving focus out of the field. */
      requestAnimationFrame(() => {
        document.querySelector(`[data-fx-entry="${CSS.escape(flat[next].key)}"]`)?.scrollIntoView({ block: "nearest" });
      });
      return;
    }
    /* Enter only inserts when a word has been typed — otherwise it is a newline, because
       this is a text field and a formula may be written over several lines. */
    if ((event.key === "Enter" && typing) || event.key === "Tab") {
      if (!highlighted) return;
      event.preventDefault();
      apply(highlighted);
    }
  };

  return (
    <MenuSurface anchor={anchor} open onClose={close} role="dialog" width={PANEL_WIDTH} maxHeight={PANEL_HEIGHT} preferHeight={460} className="db-fx">
      <div className="db-fx-head">
        <h2 className="db-fx-title">Edit formula</h2>
        <button
          type="button"
          className="db-fx-help-btn"
          aria-label="How formulas work"
          aria-expanded={help}
          onClick={() => setHelp((was) => !was)}
        >
          ?
        </button>
        <button type="button" className="db-prop-icon-btn db-menu-back db-fx-close" aria-label="Close" onClick={close}>
          <X size={15} aria-hidden />
        </button>
      </div>

      {help ? (
        <div className="db-fx-help">
          <p>A formula is written, not stored: it is computed from the row every time the table is read.</p>
          <ul>
            <li><code>prop(&quot;Due&quot;)</code> reads another property. The list below inserts it for you.</li>
            <li><code>if(prop(&quot;Done&quot;), &quot;done&quot;, &quot;open&quot;)</code> — conditions are lazy, so the branch that is not taken cannot fail.</li>
            <li>A checkbox prints as Yes / No, a date as the Date column would print it, a list as a sentence.</li>
            <li>Nothing is written until this panel closes.</li>
          </ul>
        </div>
      ) : null}

      <div className="db-fx-field">
        <pre ref={paint} className="db-fx-code" aria-hidden>
          {paintFormula(draft).map((span, index) => (
            <span key={index} className={`db-fx-t-${span.kind}`}>{span.text}</span>
          ))}
          {/* A zero-width space keeps the last line's height when the text ends in a
              newline, so the painted layer stays the same size as the field. */}
          {"​"}
        </pre>
        <textarea
          ref={field}
          className="db-fx-input"
          value={draft}
          placeholder="Write a formula…"
          spellCheck={false}
          autoComplete="off"
          maxLength={2000}
          aria-label="Formula"
          aria-describedby={result?.message ? `${id}-message` : undefined}
          onChange={(event) => { setDraft(event.target.value); setCaret(event.target.selectionStart ?? 0); setNarrowed(true); }}
          onSelect={(event) => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onScroll={(event) => { if (paint.current) paint.current.scrollTop = event.currentTarget.scrollTop; }}
        />
      </div>

      <div className="db-fx-status">
        {result?.message ? (
          <p className="db-fx-error" id={`${id}-message`} title={result.position === null ? undefined : `Character ${result.position + 1}`}>
            {result.message}
          </p>
        ) : (
          <p className="db-fx-hint">Type a name to narrow the list · ↑ ↓ to choose · Enter to insert</p>
        )}
      </div>

      <div className="db-fx-preview">
        <div className="db-fx-preview-top">
          <span className="db-fx-label">Preview with</span>
          <button
            ref={pickerAnchor}
            type="button"
            className="db-fx-row-btn"
            aria-haspopup="menu"
            aria-expanded={picker}
            onClick={() => setPicker((was) => !was)}
            disabled={rows.length === 0}
          >
            <span className="db-fx-row-name">{previewRow?.title || "Untitled"}</span>
            <ChevronDown size={12} aria-hidden />
          </button>
          <span className="db-fx-spacer" />
          <button
            type="button"
            role="switch"
            aria-checked={debug}
            className={`db-fx-switch${debug ? " is-on" : ""}`}
            onClick={() => setDebug((was) => !was)}
            title="Show the value of every part of the formula"
          >
            <span className="db-fx-switch-track" aria-hidden>
              <span className="db-fx-switch-knob" />
            </span>
            Debug mode
          </button>
        </div>
        <div className="db-fx-output">
          <span className={`db-fx-value${result && !result.text ? " is-empty" : ""}`}>
            {result ? (result.text || "No output") : "No pages yet"}
          </span>
          <span className="db-fx-type">Type: {result?.type ?? "unknown"}</span>
        </div>
      </div>

      <MenuSurface anchor={pickerAnchor} open={picker} onClose={() => setPicker(false)} maxHeight={260}>
        {rows.slice(0, 60).map((row) => (
          <MenuItem
            key={row.id}
            role="button"
            label={row.title || "Untitled"}
            check={row.id === previewRow?.id}
            onSelect={() => { setRowId(row.id); setPicker(false); }}
          />
        ))}
      </MenuSurface>

      <div className={`db-fx-body${debug ? " is-debug" : ""}`}>
        {debug ? (
          <div className="db-fx-trace" aria-label="Evaluation">
            {trace.length === 0 ? (
              <p className="db-fx-empty">Nothing has been evaluated yet.</p>
            ) : (
              [...trace].reverse().map((entry, index) => (
                <div key={index} className="db-fx-trace-row" style={{ paddingLeft: `${entry.depth * 10}px` }}>
                  <code className="db-fx-trace-code">{entry.label}</code>
                  <span className={`db-fx-trace-value${entry.type === "error" ? " is-error" : ""}`}>{entry.text || "—"}</span>
                  <span className="db-fx-trace-type">{entry.type}</span>
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            <div className="db-fx-nav" role="listbox" aria-label="Properties and functions">
              {shown.map((section) => (
                <div key={section.id} className="db-fx-section">
                  <p className="db-fx-section-title">{section.title}</p>
                  {section.entries.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      role="option"
                      aria-selected={entry.key === highlighted?.key}
                      data-fx-entry={entry.key}
                      className={`db-fx-entry${entry.key === highlighted?.key ? " is-active" : ""}`}
                      onMouseEnter={() => setActive(entry.key)}
                      onClick={() => apply(entry)}
                    >
                      <span className="db-fx-entry-icon" aria-hidden>
                        {entry.kind === "property"
                          ? <PropertyIcon name={iconNameFor(properties.find((item) => entry.key === `prop:${item.id}`) ?? { type: "text" })} size={12} />
                          : <span className="db-fx-entry-glyph">{entry.kind === "value" ? "=" : "ƒ"}</span>}
                      </span>
                      <span className="db-fx-entry-label">
                        {entry.label}
                        {entry.kind === "function" ? <span className="db-fx-entry-parens">()</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {shown.length === 0 ? <p className="db-fx-empty">Nothing matches “{suggestion.query}”.</p> : null}
            </div>

            <div className="db-fx-detail">
              {highlighted ? (
                <>
                  <div className="db-fx-detail-head">
                    <code className="db-fx-signature">{highlighted.signature}</code>
                    <span className="db-fx-kind">{highlighted.kind === "property" ? "property" : highlighted.kind}</span>
                  </div>
                  <p className="db-fx-summary">{highlighted.summary}</p>
                  <div className="db-fx-examples">
                    {highlighted.examples.map((example) => {
                      const live = previewRow ? previewFormula(example.code, previewRow, properties, now) : null;
                      return (
                        <div key={example.code} className="db-fx-example">
                          <div className="db-fx-example-code">
                            <code>{example.code}</code>
                            <button
                              type="button"
                              className="db-fx-copy"
                              aria-label={`Copy ${example.code}`}
                              title="Copy"
                              onClick={() => {
                                void navigator.clipboard?.writeText(example.code);
                                setCopied(example.code);
                                window.setTimeout(() => setCopied(""), 1200);
                              }}
                            >
                              {copied === example.code ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
                            </button>
                          </div>
                          <p className={`db-fx-example-result${live?.message || example.fails ? " is-error" : ""}`}>
                            {example.fails
                              ? "fails on purpose — this is the error case"
                              : live?.message ?? (live?.text || "no output")}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="db-fx-empty">Pick something on the left to read what it does.</p>
              )}
            </div>
          </>
        )}
      </div>
    </MenuSurface>
  );
}
