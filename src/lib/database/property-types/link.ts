import { asRecord, asText, compareNullable, collator, isEmail, isPhone, matchesText, normalizeUrl, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * URL, Email and Phone — three types with the same shape (a single string) and a
 * different idea of what a valid one is.
 *
 * They share one file because the *only* thing that differs is validation. Keeping
 * them together is what stops Phone quietly becoming an unvalidated Text column the
 * first time someone adds an editor without copy-pasting the rule.
 *
 * Stored value is the string as typed, except URL, which gets a scheme appended
 * (`example.com` → `https://example.com/`). A URL is stored resolvable so no view
 * ever has to guess at render time.
 */

const emptyOrText = (value: CellValue): string => asText(value).trim();

/**
 * How a URL column reads.
 * ---------------------------------------------------------------------------
 * A link is *stored* resolvable and *read* as the part a person typed: `https://` and
 * `www.` are what a browser adds on its own, and in a 32px cell they are the two things
 * that push the part you recognise off the right edge. So the default is short, and
 * `fullUrl` is the column's answer for the addresses where the scheme is the point — an
 * `http:` that is deliberately not `https:`, a `mailto:`, a port.
 *
 * This is presentation, not storage: `coerce` still keeps the address whole, so nothing
 * downstream — a filter, a sort, a formula — ever sees half a link.
 */
export type UrlConfig = { fullUrl?: boolean };

export function urlConfigOf(config?: unknown): Required<UrlConfig> {
  const raw = asRecord(config as CellValue) ?? {};
  return { fullUrl: raw.fullUrl === true };
}

/** The link as a person reads it: no scheme, no `www.`, no lone trailing slash. */
export function shortUrl(text: string): string {
  const bare = text.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  /* `https://example.com` is stored as `https://example.com/` — the root path's slash is
     the one slash a browser invents, and keeping it would make every plain domain the
     only link in the column that ends in punctuation it did not have. A slash after a
     path is the address's own (`/docs/`), so it stays. */
  return /^[^/?#]+\/$/.test(bare) ? bare.slice(0, -1) : bare;
}

/** The address a link *cell* points at, or `null` when this is not something to open.
 *  `normalizeUrl` is the server's own filter, so what a cell draws as a link and what the
 *  server would accept as one cannot disagree. */
export function urlHref(value: CellValue): string | null {
  return normalizeUrl(emptyOrText(value));
}

export const urlProperty: PropertyTypeSpec = {
  type: "url",
  label: "URL",
  empty: () => null,
  coerce: (raw) => normalizeUrl(asText(raw as CellValue)),
  isEmpty: (value) => emptyOrText(value) === "",
  compare: (a, b) => compareNullable(
    emptyOrText(a) === "" ? null : emptyOrText(a),
    emptyOrText(b) === "" ? null : emptyOrText(b),
    collator.compare,
  ),
  format: (value, config) => {
    const text = emptyOrText(value);
    /* The scheme lives on disk and not on screen. `formatCell` is what every view, every
       filter chip and the MCP surface read, so a link is short everywhere it is shown and
       whole everywhere it is used. */
    if (text === "" || urlConfigOf(config).fullUrl) return text;
    return shortUrl(text);
  },
  fits: (operator, value, operand) => matchesText(operator, value, operand),
  aggregates: ["count", "unique"],
};

export const emailProperty: PropertyTypeSpec = {
  type: "email",
  label: "Email",
  empty: () => null,
  coerce: (raw) => {
    /* Tolerate the `<mailto:>` and angle-bracket wrappers a paste brings with it. */
    const text = asText(raw as CellValue).replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim();
    return isEmail(text) ? text : null;
  },
  isEmpty: (value) => emptyOrText(value) === "",
  compare: (a, b) => compareNullable(
    emptyOrText(a) === "" ? null : emptyOrText(a),
    emptyOrText(b) === "" ? null : emptyOrText(b),
    collator.compare,
  ),
  format: (value) => emptyOrText(value),
  fits: (operator, value, operand) => matchesText(operator, value, operand),
  aggregates: ["count", "unique"],
};

export const phoneProperty: PropertyTypeSpec = {
  type: "phone",
  label: "Phone",
  empty: () => null,
  coerce: (raw) => {
    /* Kept exactly as typed — the punctuation is how a person recognises the number,
       and normalising it would lose the distinction between extensions and formats. */
    const text = asText(raw as CellValue).trim();
    return isPhone(text) ? text : null;
  },
  isEmpty: (value) => emptyOrText(value) === "",
  compare: (a, b) => compareNullable(
    emptyOrText(a) === "" ? null : emptyOrText(a),
    emptyOrText(b) === "" ? null : emptyOrText(b),
    (left, right) => collator.compare(left.replace(/\D/g, ""), right.replace(/\D/g, "")) || collator.compare(left, right),
  ),
  format: (value) => emptyOrText(value),
  /* `contains` ignores punctuation so "555 123" finds "+1 (555) 123-4567". */
  fits: (operator, value, operand) => {
    if (operator !== "contains" && operator !== "doesNotContain") return matchesText(operator, value, operand);
    const digits = (text: string) => text.replace(/\D/g, "");
    const hit = digits(emptyOrText(value)).includes(digits(asText(operand as CellValue)));
    return operator === "contains" ? hit : !hit;
  },
  aggregates: ["count", "unique"],
};
