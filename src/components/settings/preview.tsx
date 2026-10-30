"use client";
/* Raspberry — live palette preview (B30)
   ---------------------------------------------------------------------------
   The settings page needs to show a colour taking effect on the things colours
   are for. This is a sample, not the editor: it reads the same custom properties
   the editor reads, so if it looks right here it looks right in a block, but it
   stays cheap enough to repaint on every slider frame.

   Every colour name appears twice — once as ink, once as a fill — because that
   is the one thing a person cannot judge from a swatch: whether a hue chosen for
   text still works when it becomes a highlight, and whether the highlight is
   still legible under the body text colour.
*/

import { COLOR_LABELS, COLOR_NAMES } from "@/lib/palette";

export default function PalettePreview() {
  return (
    <div className="preview" aria-label="Palette preview">
      <h3 className="preview-title">A little space for big ideas</h3>
      <p className="preview-body">
        Body text stays neutral so the coloured words stay loud.
      </p>

      <p className="preview-ink">
        {COLOR_NAMES.map((name) => (
          <span key={name} style={{ color: `var(--bn-colors-highlights-${name}-text)` }}>
            {COLOR_LABELS[name]}{" "}
          </span>
        ))}
      </p>

      <p className="preview-fill">
        {COLOR_NAMES.map((name) => (
          <span
            key={name}
            className="preview-highlight"
            style={{
              background: `var(--bn-colors-highlights-${name}-background)`,
              color: `var(--bn-colors-highlights-${name}-text)`,
            }}
          >
            {COLOR_LABELS[name]}
          </span>
        ))}
      </p>

      <div
        className="preview-callout"
        style={{
          background: "var(--bn-colors-highlights-yellow-background)",
          color: "var(--bn-colors-highlights-yellow-text)",
        }}
      >
        <span aria-hidden>💡</span>
        <span>A callout is a highlight that carries an icon.</span>
      </div>

      <ul className="preview-list">
        <li>
          <input type="checkbox" checked readOnly aria-label="Done example" />
          <span>The tick has its own colour.</span>
        </li>
        <li>
          <input type="checkbox" readOnly aria-label="Open example" />
          <span>An open item stays neutral.</span>
        </li>
      </ul>

      <p className="preview-links">
        <a href="#preview" onClick={(event) => event.preventDefault()}>A link</a>
        <span className="preview-button">A button</span>
        <span className="preview-selected">Selected</span>
      </p>
    </div>
  );
}
