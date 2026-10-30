import { asText, compareNullable, collator, isEmail, isPhone, matchesText, normalizeUrl, type PropertyTypeSpec } from "./shared";
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
  format: (value) => emptyOrText(value),
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
