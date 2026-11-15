"use client";
/* A Place cell: the text field *is* the search box.
   ---------------------------------------------------------------------------
   The owner's words: "whenever a user clicks on a cell a dropdown appears. The cell is now
   basically a search engine for addresses and locations ... the queries show immediately as
   a new letter hits the cell."

   So this keeps the caret where a press puts it — a text cell that opens a search panel
   *instead of* taking the caret would be the URL cell's mistake in a different costume —
   and the surface hangs off the field, showing what the typing produced. Three decisions
   are worth the prose:

   **The field never shows a `title`-less address.** What the cell reads when you are not in
   it is `placeAddress`: one line, the address. What it reads while you search is what you
   are typing. Those are the same string until you pick a result, which is why picking looks
   like the cell agreeing with you rather than replacing what you wrote.

   **A keystroke is not a request.** 380ms after the last one, and never for fewer than two
   characters: one letter matches millions of places, and the provider is somebody else's
   server. A repeated query is answered from a short memo here *and* from a ten-minute cache
   on the server, so backspacing over a word and retyping it costs nothing. The pause was
   260ms until the provider stopped answering this machine after twenty rapid requests; a
   quarter of a second is a keystroke, not a pause, and the whole column was betting on a
   free service tolerating a typist's burst rate.

   **Nothing is lost when the search cannot answer.** Every state that is not a list of
   results — no matches, search switched off, provider unreachable, provider busy — still
   offers "Use <what you typed>". This column was freeform text before it was a search engine,
   this app is local-first, and a search box that silently refuses to store an address while
   it is offline would be a way to lose somebody's home. */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { RequestError, request } from "@/lib/api-client";
import { focusCellFrom } from "@/lib/database/cell-nav";
import { placeAddress, placeCard, placeReading, placeValueOf, readQuery, type PlaceHit, type PlaceReading } from "@/lib/database/property-types/place";
import type { CellValue, PropertyDef } from "@/lib/database/types";
import { MenuSurface, useMenuDismiss } from "./menu";
import { PlaceMap } from "./place-map";
import { PropertyIcon } from "./property-icons";

/* Short enough that a pause mid-word is a search, long enough that a burst of typing is one
   request rather than one per letter. */
const TYPING_PAUSE_MS = 380;
const MIN_QUERY = 2;
/* A query answered this recently is not asked again — the client's half of the cache. */
const MEMO_MS = 60_000;

type Lookup =
  | { kind: "idle" }
  | { kind: "searching" }
  /* `matchedNumber` is false when a house number was typed and no result carries it, and
     `approx` is what the rows are in that case: the address that was typed, placed on the
     road it would be on rather than on a door. The surface says both things rather than
     leaving the person to wonder which half of their address the app ignored. */
  | { kind: "found"; hits: PlaceHit[]; matchedNumber: boolean; number: string | null; approx: boolean }
  | { kind: "none"; query: string }
  | { kind: "off" }
  | { kind: "failed" }
  | { kind: "busy" };

/** Which row is under the highlight: a result, or the escape hatch that stores the text. */
type Row = { key: string; hit: PlaceHit } | { key: string; typed: string };

const sameLabel = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

export function PlaceCell({ property, value, onCommit, autoFocus }: {
  property: PropertyDef;
  value: CellValue;
  onCommit: (value: CellValue) => void;
  autoFocus?: boolean;
}) {
  const text = placeAddress(value);
  const [draft, setDraft] = useState(text);
  /* The committed value is read from a ref, not from state: a blur that arrives in the same
     task as the last keystroke runs the previous render's handler, and `draft` there is one
     keystroke behind — the write would be dropped silently. */
  const latest = useRef(text);
  const field = useRef<HTMLInputElement | null>(null);
  const memo = useRef(new Map<string, { at: number; lookup: Lookup }>());
  const uid = useId().replace(/[:]/g, "");

  const [open, setOpen] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
  const [active, setActive] = useState(0);
  /* The place just picked, held locally until the saved value arrives back. Not a cache of the
     value — it is used for exactly one thing, `held` below, and only while the field still
     reads its address. Without it, a pick whose write is still in flight would show the list
     for a frame and then the map, which reads as the app changing its mind. */
  const [picked, setPicked] = useState<PlaceReading | null>(null);

  /* The value can change under the editor — a second tab, a reload, the server's own
     `coerce` — so the field follows it unless the person is mid-keystroke in this field. */
  useEffect(() => {
    if (document.activeElement === field.current) return;
    setDraft(text);
    latest.current = text;
  }, [text]);

  /* A stable identity on purpose: `useMenuDismiss` re-arms its outside-press listener in an
     effect keyed on `onClose`, and a fresh arrow every render would clear and re-add that
     listener on every keystroke — leaving a window in which a press outside goes unheard. */
  const close = useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close, field);

  const query = draft.trim();

  /* The card, or `null` for the list. The rule is in `place.ts` (not here) because it has three
     edge cases worth asserting without a browser: a typed address has no point, a pick whose write
     is still in flight must not flash the previous place, and any keystroke means the list. */
  const card = open ? placeCard(value, picked, draft) : null;

  useEffect(() => {
    if (!open || card) return;
    if (query.length < MIN_QUERY) {
      setLookup({ kind: "idle" });
      return;
    }
    const remembered = memo.current.get(query.toLowerCase());
    if (remembered && Date.now() - remembered.at < MEMO_MS) {
      setLookup(remembered.lookup);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLookup({ kind: "searching" });
      try {
        const body = await request<{ results: PlaceHit[]; disabled?: boolean; matchedNumber?: boolean }>(
          `/api/places/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        const next: Lookup = body.disabled
          ? { kind: "off" }
          : body.results.length
            ? { kind: "found", hits: body.results, matchedNumber: body.matchedNumber !== false, number: readQuery(query).number, approx: body.results.some((hit) => hit.approx === true) }
            : { kind: "none", query };
        /* A failure is not remembered: the next keystroke is allowed to succeed. */
        memo.current.set(query.toLowerCase(), { at: Date.now(), lookup: next });
        setLookup(next);
      } catch (error) {
        if (controller.signal.aborted) return;
        /* "Busy" and "unreachable" are different sentences to the person typing: one means
           wait, the other means something is wrong. The server already distinguishes them. */
        setLookup({ kind: error instanceof RequestError && error.status === 503 ? "busy" : "failed" });
      }
    }, TYPING_PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, card]);

  const hits = lookup.kind === "found" ? lookup.hits : [];
  /* The escape hatch is a row, not a footnote, and it is offered whenever the typed text is
     not already one of the answers — so Enter on "221B Baker Street" always does something
     the person can predict. */
  const canUseTyped = query !== "" && (lookup.kind !== "idle");
  const found: Row[] = hits.map((hit) => ({ key: hit.id ?? hit.address, hit }));
  /* With the map up there is no list, and an invisible list is what the arrow keys would walk —
     a highlight moving through rows nobody can see, and Enter picking one. */
  const rows: Row[] = card ? [] : canUseTyped && !hits.some((hit) => sameLabel(hit.address, query))
    ? [...found, { key: "typed", typed: query }]
    : found;

  /* A new answer set means a new first row; leaving the old index would highlight whichever
     row happened to land in the same position. */
  useEffect(() => { setActive(0); }, [lookup]);

  const pick = (row: Row) => {
    const next = "hit" in row ? placeValueOf(row.hit) : row.typed;
    const address = "hit" in row ? row.hit.address : row.typed;
    const stored = placeReading(next);
    setDraft(address);
    latest.current = address;
    onCommit(next);
    setPicked(stored);
    /* A pick with a point leaves the surface open, so the list is *replaced* by the map of what
       was just chosen — the owner's reference. A typed value has nothing to draw and the list
       closes, exactly as before. */
    if (stored.point === null) setOpen(false);
  };

  /* Clearing is the `×` on the card. The cell is emptied rather than blurred away, the surface
     stays open on the idle note, and the caret stays in the field, because the reason to clear
     a place is almost always to search for another one. */
  const clear = () => {
    setPicked(null);
    setDraft("");
    latest.current = "";
    onCommit(null);
    field.current?.focus();
  };

  const commitDraft = () => {
    if (latest.current !== text) onCommit(latest.current);
  };

  return (
    <div className="db-place-cell">
      <input
        ref={(node) => { field.current = node; }}
        className="db-cell-input db-place-input"
        aria-label={property.name}
        role="combobox"
        /* `open`, not `open && rows.length > 0`: the surface is on screen with a note in it
           ("Type a place or address") before any result exists, and telling a screen reader
           the combobox is collapsed while a panel is visibly open is the one thing `aria-
           expanded` exists to prevent. */
        aria-expanded={open}
        aria-controls={`${uid}-places`}
        aria-autocomplete="list"
        aria-activedescendant={open && rows.length ? `${uid}-place-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        value={draft}
        type="text"
        placeholder="Search a place…"
        onChange={(event) => { setDraft(event.target.value); latest.current = event.target.value; setOpen(true); }}
        onFocus={() => setOpen(true)}
        /* A press is also an opening gesture, and that is not the same event as focus. After a
           result is picked the caret stays in this field, so the *next* press here changes no
           focus and fires no `focus` event — a cell that opened on focus alone was a cell you
           could not reopen without clicking something else first. */
        onClick={() => setOpen(true)}
        onBlur={() => { setOpen(false); commitDraft(); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (event.altKey || event.metaKey || event.ctrlKey) return;
            /* With a list on screen the arrows walk the list; with none they walk the table,
               which is how every other cell behaves and how a person leaves this one without
               having to reach for Escape. */
            if (!rows.length) {
              event.preventDefault();
              focusCellFrom(event.currentTarget, event.key === "ArrowDown" ? "down" : "up");
              return;
            }
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((current) => (current + step + rows.length) % rows.length);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const row = rows[active];
            if (row) { pick(row); return; }
            /* No list, no highlight: Enter is "next row, same column", exactly as in a text
               cell. Falling through to the blur below is what commits. */
            if (!focusCellFrom(event.currentTarget, "down")) event.currentTarget.blur();
            return;
          }
          if (event.key === "Escape") {
            /* First Escape closes the list and leaves you where you were; a second one gives
               the cell back the value it had. Closing the surface *and* discarding an edit on
               one press would make Escape unreliable exactly when it matters. */
            if (open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              return;
            }
            setDraft(text);
            latest.current = text;
            event.currentTarget.blur();
          }
        }}
      />
      <MenuSurface
        id={`${uid}-places`}
        anchor={field}
        open={open}
        onClose={close}
        /* A list of options, until it is a card with a map, a link and a button in it — a
           `listbox` whose rows are not options would announce a pressable arrow as a place. */
        role={card ? "dialog" : "listbox"}
        className="db-place-menu"
        /* The list is six two-line rows at most; `preferHeight` is what makes a cell near the
           bottom of the window open its results *upward* instead of scrolling them. */
        preferHeight={320}
      >
        {card ? (
          <div className="db-place-card">
            <div className="db-place-card-head">
              <span className="db-place-card-address" title={card.address}>{card.address}</span>
              <button
                type="button"
                className="db-prop-icon-btn db-menu-back db-place-card-clear"
                aria-label="Clear place"
                title="Clear place"
                onClick={clear}
              >
                <X size={13} aria-hidden />
              </button>
            </div>
            <PlaceMap point={card.point} approximate={card.approximate} label={card.address} />
            {/* The place's own name, when it is not the address: the farm standing at "Grahovo
                Brdo 1". It is stored with the point and would otherwise never be seen again. */}
            {card.name && card.name !== card.address ? <p className="db-place-card-meta">{card.name}</p> : null}
            {/* A composed address sits on the road, not on the door. One line, and only when it
                is true — the pin already looks different, and a legend for a pin nobody can
                compare is noise. */}
            {card.approximate ? <p className="db-place-card-meta">Placed on the road, not the door</p> : null}
          </div>
        ) : rows.map((row, index) => {
          const on = index === active;
          if ("typed" in row) {
            return (
              <button
                key={row.key}
                type="button"
                role="option"
                aria-selected={on}
                id={`${uid}-place-${index}`}
                className="db-option-create db-place-use"
                onMouseMove={() => setActive(index)}
                onClick={() => pick(row)}
              >
                Use <strong>“{row.typed}”</strong>
              </button>
            );
          }
          const isCurrent = sameLabel(row.hit.address, text);
          return (
            <div
              key={row.key}
              role="option"
              aria-selected={on}
              id={`${uid}-place-${index}`}
              className={on ? "db-place-row is-active" : "db-place-row"}
              onMouseMove={() => setActive(index)}
              onClick={() => pick(row)}
            >
              <span className="db-place-glyph"><PropertyIcon name="map-pin" size={14} /></span>
              <span className="db-place-text">
                {/* The bold line is the field of the result that answered the query, not
                    unconditionally the place's own name. Searching "Grahovo Brdo 1" used to
                    produce a row headed *Turistična kmetija Mahnič* — a real farm at that
                    address, and an unreadable answer to what was typed. */}
                <span className="db-place-name">{row.hit.label}</span>
                {/* The context is the half a person scans to tell two "Springfield"s apart,
                    so it gets its own line and its own colour rather than being glued onto
                    the name inside one truncated string. */}
                {row.hit.context ? <span className="db-place-context">{row.hit.context}</span> : null}
              </span>
              {isCurrent ? <Check size={13} className="db-place-check" aria-hidden /> : null}
            </div>
          );
        })}
        {card ? null : <PlaceNote lookup={lookup} />}
      </MenuSurface>
    </div>
  );
}

/**
 * The surface's one voice for everything that is not a place.
 *
 * Each of these says a different thing, and the difference is the whole point: "nothing
 * matches" is about the world, "search is off" is about this app's settings, "busy" is about
 * the provider's patience, and "could not be reached" is about the network. An app that
 * renders all of them as an empty list teaches the person to retype a correct address.
 *
 * The last two are not failures at all. When a house number is typed and no result carries
 * it, the rows above are that address placed on the road it would be on — which is the truth
 * about the map data, and saying it is the difference between "this app ignores my number" and
 * "this number is not mapped". The road's point is not the door's, so that row says so too.
 */
function PlaceNote({ lookup }: { lookup: Lookup }) {
  const note =
    lookup.kind === "idle" ? "Type a place or address"
    : lookup.kind === "searching" ? "Searching…"
    : lookup.kind === "none" ? `Nothing found for “${lookup.query}”`
    : lookup.kind === "off" ? "Place search is off — what you type is saved as it is"
    : lookup.kind === "busy" ? "Place search is busy — try again in a moment"
    : lookup.kind === "failed" ? "The place service could not be reached"
    : lookup.kind === "found" && !lookup.matchedNumber && lookup.number !== null && lookup.approx
      ? `No house ${lookup.number} in the map data — it is placed on the road, not the door`
    : lookup.kind === "found" && !lookup.matchedNumber && lookup.number !== null
      ? `No house ${lookup.number} in the map data — these are the places around it`
    : null;
  if (!note) return null;
  return <p className="db-place-note">{note}</p>;
}
