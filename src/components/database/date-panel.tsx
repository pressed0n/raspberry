"use client";
/* Dates — one surface that answers all three questions at once.
   ---------------------------------------------------------------------------
   The cell used to be a native `<input type="date">`. That gave a person one day, no
   end, no clock, and a browser dialog on Windows that looks nothing like the rest of
   this app — and the property menu had no way to say how the column should read, so
   every date was an ISO string.

   WHAT THIS FILE OWNS
   - the trigger. A button, like a tag cell, because `TableView` mounts every cell's
     editor whenever the table is editable: a control that opened itself would open on
     every row at once.
   - the two bounds, the clocks, and the month grid.
   - `End date` and `Include time`, as menu rows — the same `.db-menu-item db-menu-row`
     the rest of the app's menus are built from, tick and all.
   - `Date format`, as a *fly-out*: the same six rows the property menu draws (they live in
     `date-format-rows.tsx`, imported by both), opened beside this surface by the same
     `MenuSub` every other submenu in the app uses. The owner asked for it here because the
     format is a reading of the value in front of you, and then asked for it to be a fly-out
     rather than a body swap — "those options should open next to the dropdown". It is one
     pick away either way; the difference is whether the calendar disappears while you
     choose.

   WHAT IT DELIBERATELY DOES NOT OWN
   The arithmetic. `lib/database/calendar.ts` is pure and tested there: a fixed six-week
   grid, a typed time, a stepped time, and two bounds put back in order. What is left
   here is layout and intent.

   THREE DECISIONS WORTH THE WORDS
   1. Clicking a day writes *immediately* — there is no OK button. Every other cell in
      this table saves as you go, and a picker that needed confirming would be the one
      control with a modal's habits.
   2. The calendar writes to the bound you last touched. Pressing a day while `End date`
      is on and empty moves the pen to the end, so a range is two clicks: start, end.
      That is the whole "select start and end in one date" answer.
   3. When a pick would put the start after the end, the two swap and the pen follows
      the day you just pressed. `orderBounds` does the swap, and the server's own
      `coerce` agrees with it — an end before a start is dropped there, silently, which
      is the one outcome worth avoiding. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  dayInMonth,
  joinFloating,
  monthGrid,
  monthOf,
  monthTitle,
  orderBounds,
  parseTimeInput,
  shiftMonth,
  splitFloating,
  stepTime,
  todayKey,
  WEEKDAY_LABELS,
} from "@/lib/database/calendar";
import { formatCell, dateFormatLabel } from "@/lib/database/properties";
import { dateBounds, dateConfigOf, dayHead, type DateConfig } from "@/lib/database/property-types/date";
import type { CellValue, PropertyDef } from "@/lib/database/types";
import { MenuDivider, MenuItem, MenuSub, MenuSurface, useMenuDismiss } from "./menu";
import { DateFormatRows, TimeFormatRows } from "./date-format-rows";

type Bound = "start" | "end";

export function DateCell({
  property,
  value,
  onCommit,
  onConfig,
  autoFocus,
}: {
  property: PropertyDef;
  value: CellValue;
  onCommit: (value: CellValue) => void;
  /* "Include time" is a property setting, not a per-row one: it says how this column
     reads, the same way "Number format" does. Optional, because a read-only table has
     nothing to write it to. */
  onConfig?: (patch: Record<string, unknown>) => Promise<unknown> | void;
  autoFocus?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(Boolean(autoFocus));
  const close = useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close);
  const text = formatCell(property, value);

  return (
    <div className="db-date-cell">
      <button
        ref={trigger}
        type="button"
        className="db-date-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${property.name}: ${text || "empty"}`}
        onMouseDown={(event) => {
          /* The press is the toggle, as in a tag cell: a plain `onClick` would arrive
             after the dismissal listener had already closed the surface. */
          event.preventDefault();
          setOpen((was) => !was);
        }}
      >
        {text ? <span className="db-date-text">{text}</span> : <span className="db-cell-empty">Empty</span>}
      </button>

      {/* `maxHeight`/`preferHeight`: the panel is about 380px tall and it needs all of it —
          a calendar cut in half loses its last two weeks, and the two toggles live at the
          bottom. So it says how tall it wants to be, and flips above the cell rather than
          scrolling when the room below is short. */}
      <MenuSurface
        anchor={trigger}
        open={open}
        onClose={close}
        maxHeight={430}
        preferHeight={390}
        className="db-date-menu"
        role="dialog"
      >
        <DatePanel property={property} value={value} onCommit={onCommit} onConfig={onConfig} />
      </MenuSurface>
    </div>
  );
}

function DatePanel({
  property,
  value,
  onCommit,
  onConfig,
}: {
  property: PropertyDef;
  value: CellValue;
  onCommit: (value: CellValue) => void;
  onConfig?: (patch: Record<string, unknown>) => Promise<unknown> | void;
}) {
  const config = dateConfigOf(property.config);
  const { start, end } = useMemo(() => dateBounds(value), [value]);
  const from = splitFloating(start);
  const to = splitFloating(end);

  /* The toggle's own state, because `end` is a value and "I want a range" is an intent:
     pressing `End date` on an empty cell must show a second row before there is anything
     to write. Every write still goes through the value, so a closed and reopened panel
     reads the truth back from what the cell holds. */
  const [wantEnd, setWantEnd] = useState(end !== null);
  const [active, setActive] = useState<Bound>("start");
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(() => monthOf(from.day ?? todayKey()));
  const [cursor, setCursor] = useState(() => from.day ?? todayKey());
  const grid = useRef<HTMLDivElement>(null);
  const pending = useRef(false);

  const today = todayKey();
  const endOn = wantEnd;

  const write = useCallback(
    (nextStart: string | null, nextEnd: string | null) => {
      const ordered = orderBounds(nextStart, nextEnd);
      onCommit(ordered.start === null ? null : { start: ordered.start, end: ordered.end });
    },
    [onCommit],
  );

  /* One press on a day. See decisions 2 and 3 in the file comment. */
  const pick = (day: string) => {
    setHover(null);
    if (active === "end" && start) {
      /* A range inside one day keeps one clock: an end on the start's own day with no
         time of its own inherits the start's time. Without it the untimed day sorts
         *before* a timed start and the two bounds would swap the moment it was written. */
      const time = to.time ?? (day === from.day ? from.time : null);
      write(start, joinFloating(day, time));
      return;
    }
    const nextStart = joinFloating(day, from.time);
    const ordered = orderBounds(nextStart, end);
    onCommit({ start: ordered.start, end: ordered.end });
    /* Two clicks make a range: pick a start, and the pen moves to the end if there is one
       to place. Otherwise it stays wherever the day landed, which is the bound a swap
       moved it to. */
    setActive(endOn && end === null ? "end" : ordered.start === nextStart ? "start" : "end");
  };

  const setTime = (bound: Bound, time: string | null) => {
    if (bound === "start") {
      if (!from.day) return;
      write(joinFloating(from.day, time), end);
      return;
    }
    if (!to.day) return;
    write(start, joinFloating(to.day, time));
  };

  const toggleEnd = () => {
    const next = !wantEnd;
    setWantEnd(next);
    if (next) {
      setActive("end");
      return;
    }
    /* Off clears the end. A switch that only *looks* unchecked while the value keeps its
       end would be a switch that lies, and this one is two rows away from the value. */
    write(start, null);
    setActive("start");
  };

  const goMonth = (delta: number) => setView((was) => shiftMonth(was, delta));

  /* Keyboard traversal of the grid, in one place: arrows by day and week, Home/End by
     week, PageUp/PageDown by month. `stopPropagation` matters — `MenuSurface` binds
     ArrowUp/Down to menu-row traversal, and letting it also run would move focus out of
     the calendar mid-keystroke. */
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)?.focus({ preventScroll: true });
  }, [cursor, view]);

  const onGridKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const at = (event.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day ?? cursor;
    let next: string;
    if (event.key === "PageUp" || event.key === "PageDown") {
      const moved = shiftMonth(monthOf(at), event.key === "PageUp" ? -1 : 1);
      setView(moved);
      next = dayInMonth(moved, Number(at.slice(8, 10)));
    } else if (event.key === "Home" || event.key === "End") {
      /* Monday and Sunday of the week this day is in. */
      const weekday = (new Date(`${at}T00:00:00Z`).getUTCDay() + 6) % 7;
      next = addDays(at, event.key === "Home" ? -weekday : 6 - weekday);
    } else {
      next = addDays(at, event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -7 : 7);
    }
    pending.current = true;
    setCursor(next);
    /* The month follows the focus, so arrowing past the 1st or the 31st keeps going
       instead of stopping at an edge that looks like the end of time. */
    setView(monthOf(next));
  };

  const weeks = useMemo(() => monthGrid(view), [view]);
  const bandEnd = endOn ? to.day ?? hover : null;
  const low = from.day && bandEnd ? (from.day <= bandEnd ? from.day : bandEnd) : null;
  const high = from.day && bandEnd ? (from.day <= bandEnd ? bandEnd : from.day) : null;

  return (
    <div className="db-date-panel">
      <div className="db-date-bounds">
        <BoundRow
          bound="start"
          label="Start"
          parts={from}
          config={config}
          active={active === "start"}
          onActivate={() => setActive("start")}
          onTime={(time) => setTime("start", time)}
        />
        {endOn ? (
          <BoundRow
            bound="end"
            label="End"
            parts={to}
            config={config}
            active={active === "end"}
            onActivate={() => setActive("end")}
            onTime={(time) => setTime("end", time)}
          />
        ) : null}
      </div>

      <div className="db-cal">
        <div className="db-cal-head">
          <button type="button" className="db-cal-nav" aria-label="Previous month" onClick={() => goMonth(-1)}>
            <ChevronLeft size={14} aria-hidden />
          </button>
          <span className="db-cal-title" aria-live="polite">{monthTitle(view)}</span>
          <button type="button" className="db-cal-nav" aria-label="Next month" onClick={() => goMonth(1)}>
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>

        <div className="db-cal-grid" role="grid" aria-label={monthTitle(view)} ref={grid} onKeyDown={onGridKeys}>
          <div className="db-cal-week" role="row">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="db-cal-dow" role="columnheader" aria-label={label}>{label.slice(0, 1)}</span>
            ))}
          </div>
          {weeks.map((week) => (
            <div className="db-cal-week" role="row" key={week[0].day}>
              {week.map((cell) => {
                const edge = cell.day === from.day || (bandEnd !== null && cell.day === bandEnd);
                const inside = low !== null && high !== null && cell.day > low && cell.day < high;
                const classes = [
                  "db-cal-day",
                  cell.outside ? "is-outside" : "",
                  edge ? "is-edge" : "",
                  /* The far edge of a previewed range is not a value, so it is drawn as a
                     hint rather than as a filled bound. */
                  cell.day === from.day ? "is-start" : "",
                  edge && cell.day !== from.day ? "is-end" : "",
                  inside ? "is-band" : "",
                  cell.day === today && !edge ? "is-today" : "",
                  cell.day === cursor ? "is-cursor" : "",
                ].filter(Boolean).join(" ");
                return (
                  <span role="gridcell" key={cell.day} aria-selected={cell.day === from.day || cell.day === to.day}>
                    <button
                      type="button"
                      data-day={cell.day}
                      tabIndex={cell.day === cursor ? 0 : -1}
                      className={classes}
                      aria-label={cell.day}
                      aria-current={cell.day === today ? "date" : undefined}
                      onClick={(event) => {
                        pick(cell.day);
                        setCursor(cell.day);
                        /* The surface suppresses the press's default, so the button was
                           never focused by the click — take focus explicitly or the arrow
                           keys would have nowhere to start from. */
                        event.currentTarget.focus({ preventScroll: true });
                      }}
                      onMouseEnter={() => { if (endOn && end === null && from.day) setHover(cell.day); }}
                      onMouseLeave={() => setHover(null)}
                    >
                      {cell.dom}
                    </button>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="db-date-foot">
        <button
          type="button"
          className="db-date-link"
          onClick={() => {
            setView(monthOf(today));
            setCursor(today);
            pick(today);
          }}
        >
          Today
        </button>
        {start ? (
          <button
            type="button"
            className="db-date-link"
            onClick={() => {
              onCommit(null);
              setWantEnd(false);
              setActive("start");
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      <MenuDivider />
      <MenuItem role="button" label="End date" check={endOn} onSelect={toggleEnd} />
      {onConfig ? (
        <MenuItem
          role="button"
          label="Include time"
          check={config.includeTime}
          onSelect={() => { void onConfig({ includeTime: !config.includeTime }); }}
        />
      ) : null}
      {onConfig ? (
        /* Fly-out, not a body swap: the owner asked for these rows to open *beside* the
           picker. `MenuSub` is the app's one submenu — it opens to the right of this row,
           flips to the left when the room is gone, and keeps the calendar behind it. The
           row names the format the column is on, because the setting is the column's: one
           pick changes how every date in it reads. Picking leaves the fly-out open so a
           format and a clock can be set in one visit, with the bound row above the grid
           re-reading in the new format as the acknowledgement. */
        <MenuSub role="button" label="Date format" trailing={dateFormatLabel(config.format)} preferHeight={260}>
          <DateFormatRows format={config.format} onPick={(format) => { void onConfig({ format }); }} />
          {config.includeTime ? (
            <TimeFormatRows clock={config.timeFormat} onPick={(clock) => { void onConfig({ timeFormat: clock }); }} />
          ) : null}
        </MenuSub>
      ) : null}
    </div>
  );
}

/** One bound: the day it names, and its clock when the column has times. */
function BoundRow({
  bound,
  label,
  parts,
  config,
  active,
  onActivate,
  onTime,
}: {
  bound: Bound;
  label: string;
  parts: { day: string | null; time: string | null };
  config: Required<DateConfig>;
  active: boolean;
  onActivate: () => void;
  onTime: (time: string | null) => void;
}) {
  return (
    <div
      className={`db-date-bound${active ? " is-active" : ""}`}
      onMouseDown={(event) => {
        /* Where the next calendar press lands. On the row, not on the day button, so
           pressing the clock also says "this is the bound I am editing". */
        if ((event.target as HTMLElement).closest("input")) return;
        onActivate();
      }}
    >
      <span className="db-date-glyph" aria-hidden>{bound === "end" ? "→" : ""}</span>
      <button type="button" className="db-date-day" aria-label={`${label} date`} onClick={onActivate}>
        {parts.day ? dayHead(parts.day, config) : <span className="db-date-placeholder">Select a date</span>}
      </button>
      {config.includeTime && parts.day ? (
        <TimeField label={`${label} time`} value={parts.time} onChange={onTime} />
      ) : null}
    </div>
  );
}

/**
 * A clock the arrow keys can move.
 *
 * A native `<input type="time">` would be a second browser widget inside a surface this
 * component already draws; a text field with a `--:--` placeholder says "no time yet"
 * honestly — an empty box holding `00:00` would claim midnight, which is a value.
 * Typing is parsed loosely (`930`, `9:30`, `9`); ↑/↓ step five minutes, ⇧↑/⇧↓ an hour.
 */
function TimeField({ label, value, onChange }: { label: string; value: string | null; onChange: (time: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value ?? "");

  /* The value can change under the field — another bound's write, a re-coerce — so it
     follows, unless the person is mid-keystroke in this very field. */
  useEffect(() => {
    if (document.activeElement === ref.current) return;
    setDraft(value ?? "");
  }, [value]);

  const commit = () => {
    const text = draft.trim();
    if (text === "") {
      setDraft("");
      if (value !== null) onChange(null);
      return;
    }
    const parsed = parseTimeInput(text);
    if (parsed === null) {
      /* Refused, not written: the server would drop a value it cannot read, and a field
         that cleared itself in silence is the same bug in a prettier costume. */
      setDraft(value ?? "");
      return;
    }
    setDraft(parsed);
    if (parsed !== value) onChange(parsed);
  };

  return (
    <input
      ref={ref}
      className="db-date-time"
      value={draft}
      placeholder="--:--"
      aria-label={label}
      title="No time set — type one, or press ↑"
      inputMode="numeric"
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const step = (event.shiftKey ? 60 : 5) * (event.key === "ArrowUp" ? 1 : -1);
          const next = stepTime(parseTimeInput(draft) ?? value, step);
          setDraft(next);
          onChange(next);
          return;
        }
        if (event.key === "Escape") {
          setDraft(value ?? "");
          event.currentTarget.blur();
        }
      }}
    />
  );
}
