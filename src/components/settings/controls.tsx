"use client";
/* Raspberry — settings controls (B34)
   ---------------------------------------------------------------------------
   Two primitives, one paired slider, one strip, and one disclosure.

   The strip came in at B32 and replaced a 160px colour ring: nine equal slices
   gave every colour an 18° target and spent ~200px of height saying what nine
   chips say in 24. It is used by all three colour groups, so "choose a colour"
   is learned once.

   B33 removed the last of the second-guessing. A block colour is *two* colours —
   the ink and the fill behind it — and B32 made you pick which one to look at
   with a segmented control, which turned a synchronous comparison ("is the text
   dark enough against this fill?") into two separate visits to the same panel.
   `PairAxis` puts both halves on the same row: one label, one row per axis, the
   text track always on the left and the fill track always on the right. Same
   height as one half used to cost, and the alignment now *is* the comparison —
   you can see that the fill sits 50 points lighter than the ink without reading
   a number.

   B34 split the groups into two tiers. Primary and tick are one decision with two
   depths: pick a chip (everybody), or dial an exact hue (almost nobody). The
   sliders sit behind `AdvancedToggle` / `AdvancedPanel` so the shallow decision
   gets the whole surface and the deep one is one click away — with the toggle on
   the heading line rather than on a row of its own.

   Every control here is a range input or a button on purpose: the sliders the
   browser ships are the sliders a screen reader, a keyboard and a phone already
   know how to drive.
*/

import { ChevronRight } from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { hslToHex, type ColorGroup, type Hsl } from "@/lib/palette";

/** One choice on a strip. `edited` means "differs from the shipped default", and
 *  draws a dot, so a customised palette is readable at a glance. */
export type Swatch = { label: string; hsl: Hsl; edited?: boolean };

/* --------------------------------------------------------------------------
   Group — a heading, an optional action, and its controls
   -------------------------------------------------------------------------- */

export function Group({ title, action, children }: {
  title: string; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="set-group" role="group" aria-label={title}>
      <div className="set-group-head">
        <h4>{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

/* --------------------------------------------------------------------------
   Advanced — the second tier
   -------------------------------------------------------------------------- */

/** The affordance that reveals a group's fine controls.
 *
 *  It is passed to `Group`'s `action` slot so it rides the heading line. That is
 *  the whole trick: a disclosure row of its own would cost ~24px per group, which
 *  is most of the 44px the sliders were spending. The words "Advanced" are not
 *  decoration either — a lone chevron on a section header is the accordion
 *  gesture, and "this collapses the section" is the wrong guess to invite when
 *  the truth is "there are more controls in here". */
export function AdvancedToggle({ open, controls, onToggle, children }: {
  open: boolean;
  /** id of the `AdvancedPanel` this button owns. */
  controls: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="adv-toggle"
      aria-expanded={open}
      aria-controls={controls}
      data-open={open ? "" : undefined}
      onClick={onToggle}
    >
      <ChevronRight size={12} strokeWidth={2.5} aria-hidden className="adv-chevron" />
      <span>{children}</span>
    </button>
  );
}

/** The panel itself. Open/closed is a `data-open` attribute rather than a mount,
 *  so the height can animate — a disclosure that snaps open reads as a different
 *  component from the rest of the surface.
 *
 *  `inert` while closed is the part that is easy to forget and impossible to see:
 *  a `0fr` grid row still contains three focusable range inputs, so without it the
 *  tab key lands on sliders that are not on screen. */
export function AdvancedPanel({ open, id, children }: {
  open: boolean;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="adv-panel" id={id} data-open={open ? "" : undefined} inert={!open}>
      <div className="adv-panel-inner">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Axis — one integer on a slider
   -------------------------------------------------------------------------- */

export function Axis({ label, name, value, max, suffix, onChange, testId }: {
  /** What fits above a 3-across track — "Sat", not "Saturation". */
  label: string;
  /** What a screen reader says. Falls back to `label`. */
  name?: string;
  value: number; max: number; suffix?: string;
  onChange: (value: number) => void; testId?: string;
}) {
  return (
    <label className="axis" data-axis={testId}>
      <span className="axis-label">{label}</span>
      <input
        type="range" min={0} max={max} step={1} value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={name ?? label}
      />
      <output className="axis-value">{value}{suffix}</output>
    </label>
  );
}

/* --------------------------------------------------------------------------
   PairAxis — one integer on two sliders: the ink and the fill
   -------------------------------------------------------------------------- */

/** A single track. Split out because the two halves of a pair differ only in
 *  which numbers they are handed, and a duplicated `<input type="range">` is a
 *  place for one of them to drift. */
function Track({ part, name, value, max, suffix, onChange }: {
  part: ColorGroup; name: string; value: number; max: number;
  suffix: string; onChange: (value: number) => void;
}) {
  return (
    <label className="paxis-track" data-part={part}>
      <input
        type="range" min={0} max={max} step={1} value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={name}
      />
      <output className="axis-value">{value}{suffix}</output>
    </label>
  );
}

export function PairAxis({ label, name, text, fill, max, suffix, onChange, testId }: {
  /** What fits in the label column — "Sat", not "Saturation". */
  label: string;
  /** What a screen reader says. Falls back to `label`. */
  name?: string;
  text: number;
  fill: number;
  max: number;
  suffix?: string;
  onChange: (part: ColorGroup, value: number) => void;
  testId?: string;
}) {
  const spoken = name ?? label;
  const tail = suffix ?? "";
  return (
    <div className="paxis" data-axis={testId}>
      <span className="paxis-label">{label}</span>
      <Track part="text" name={`${spoken} of the text colour`} value={text} max={max} suffix={tail} onChange={(value) => onChange("text", value)} />
      <Track part="background" name={`${spoken} of the fill colour`} value={fill} max={max} suffix={tail} onChange={(value) => onChange("background", value)} />
    </div>
  );
}

/* --------------------------------------------------------------------------
   SwatchStrip — the one way to choose a colour
   -------------------------------------------------------------------------- */

export function SwatchStrip({ swatches, active, onPick, label }: {
  swatches: Swatch[];
  /** Index of the chosen swatch, or -1 when the value matches none of them. */
  active: number;
  onPick: (index: number) => void;
  label: string;
}) {
  // With no match the first swatch keeps the tab stop, so the group is always
  // reachable by keyboard even after a custom hue lands between two chips.
  const stop = active >= 0 && active < swatches.length ? active : 0;

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = swatches.length - 1;
    const from = Number((event.target as HTMLElement).dataset.swatch ?? stop);
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = from === last ? 0 : from + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = from === 0 ? last : from - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next < 0) return;
    event.preventDefault();
    onPick(next);
    // Focus follows selection: the roving tabindex has not re-rendered yet, but
    // `focus()` does not care what the tabindex currently says.
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-swatch="${next}"]`)?.focus();
  };

  return (
    <div className="swatches" role="radiogroup" aria-label={label} onKeyDown={move}>
      {swatches.map((swatch, index) => {
        const on = index === active;
        return (
          <button
            key={swatch.label}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={swatch.edited ? `${swatch.label}, customised` : swatch.label}
            title={swatch.label}
            className={on ? "swatch is-active" : "swatch"}
            data-swatch={index}
            data-edited={swatch.edited ? "" : undefined}
            tabIndex={index === stop ? 0 : -1}
            style={{ "--swatch": hslToHex(swatch.hsl) } as CSSProperties}
            onClick={() => onPick(index)}
          />
        );
      })}
    </div>
  );
}
