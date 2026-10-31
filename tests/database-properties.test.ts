import { test } from "node:test";
import assert from "node:assert/strict";
import { propertyTypes, numberFormats, type PropertyType } from "../src/lib/database/types";
import {
  availableTypes,
  currencies,
  currencySymbol,
  formatCell,
  numberFormatChoices,
  resolveProperty,
  sortKind,
  sortLabels,
} from "../src/lib/database/properties";

/**
 * B39 — the property registry, type by type.
 *
 * These are the assertions that make a *view* safe. A view never learns what a type
 * means; it calls `format` to render, `compare` to sort and `fits` to filter. If any
 * of those three lies for any type, every view inherits the lie, so each type is
 * pinned here rather than in whatever view happens to use it first.
 *
 * `coerce` is the write path: it is the only thing standing between arbitrary JSON
 * from a client (or an import, or a formula) and a stored value.
 */

const spec = (type: PropertyType) => resolveProperty({ type });
const config = (type: PropertyType, patch: Record<string, unknown> = {}) => patch;

test("the registry is complete — every type in the vocabulary has a spec", () => {
  for (const type of propertyTypes) {
    const resolved = spec(type);
    assert.equal(resolved.type, type, `${type} resolved to ${resolved.type}`);
    assert.ok(resolved.label.length > 0, `${type} has no label`);
  }
  assert.equal(availableTypes().length, propertyTypes.length);
});

test("no spec invents a value out of nothing", () => {
  /* The empty cell of every type must survive a round trip through coerce, or a
     filtered-out row and a never-touched row become different things. */
  for (const type of propertyTypes) {
    const resolved = spec(type);
    const empty = resolved.empty();
    assert.ok(resolved.isEmpty(empty, config(type)), `${type} does not consider its own empty value empty`);
    assert.equal(resolved.format(empty, config(type)), "", `${type} formats an empty cell as something`);
  }
});

/* ---------------------------------------------------------------------------
   Text and number are the two that shipped with the substrate. They are pinned
   here only so a refactor of the registry cannot quietly change them.
   --------------------------------------------------------------------------- */

test("text still coerces, sorts and filters as text", () => {
  const text = spec("text");
  assert.equal(text.coerce(42, {}), "42");
  assert.equal(text.format("hello", {}), "hello");
  assert.ok(text.compare("apple", "banana", {}) < 0);
  assert.equal(text.fits("contains", "Hello world", "WORLD", {}), true);
  assert.equal(text.fits("isEmpty", "", null, {}), true);
});

test("number still sorts missing values after present ones", () => {
  const number = spec("number");
  assert.equal(number.coerce("1,234", {}), 1234);
  assert.equal(number.coerce("abc", {}), null);
  assert.equal(number.compare(1, 2, {}), -1);
  assert.equal(number.compare(null, 2, {}), 1, "an empty cell sorts last");
  assert.equal(number.format(5400, { format: "duration" }), "1h 30m");
});

/* ---------------------------------------------------------------------------
   Checkbox — the tri-state the wishlist does not mention but every user means.
   --------------------------------------------------------------------------- */

test("a checkbox distinguishes untouched from unticked", () => {
  const checkbox = spec("checkbox");
  assert.equal(checkbox.coerce(true, {}), true);
  assert.equal(checkbox.coerce("no", {}), false);
  assert.equal(checkbox.coerce("", {}), null, "a blank cell is not 'false'");
  assert.equal(checkbox.isEmpty(null, {}), true);
  assert.equal(checkbox.isEmpty(false, {}), false, "an unticked box is a real answer");
  assert.equal(checkbox.format(null, {}), "");
  assert.equal(checkbox.format(true, {}), "Yes");
  assert.ok(checkbox.compare(false, true, {}) < 0);
});

/* ---------------------------------------------------------------------------
   URL / Email / Phone
   --------------------------------------------------------------------------- */

test("a URL is stored resolvable, so no view has to guess a scheme", () => {
  const url = spec("url");
  assert.equal(url.coerce("example.com", {}), "https://example.com/");
  assert.equal(url.coerce("http://example.com/x", {}), "http://example.com/x");
  assert.equal(url.coerce("not a url", {}), null);
  assert.equal(url.coerce("javascript:alert(1)", {}), null, "only http(s) and mailto are URLs");
});

test("an email tolerates the wrappers a paste brings", () => {
  const email = spec("email");
  assert.equal(email.coerce("mailto:a@b.co", {}), "a@b.co");
  assert.equal(email.coerce("<a@b.co>", {}), "a@b.co");
  assert.equal(email.coerce("a@b", {}), null, "no dot in the domain is not an address");
});

test("a phone keeps its punctuation but matches on digits", () => {
  const phone = spec("phone");
  assert.equal(phone.coerce("+1 (555) 123-4567", {}), "+1 (555) 123-4567");
  assert.equal(phone.coerce("123", {}), null);
  assert.equal(phone.fits("contains", "+1 (555) 123-4567", "555123", {}), true);
});

/* ---------------------------------------------------------------------------
   Select / Multi-select / Status — options live in config, cells hold ids.
   --------------------------------------------------------------------------- */

const tags = {
  options: [
    { id: "o1", name: "Red", color: "red", groupId: null },
    { id: "o2", name: "Blue", color: "blue", groupId: null },
  ],
};

test("a select stores an id and renders the name", () => {
  const select = spec("select");
  assert.equal(select.coerce("o2", tags), "o2");
  assert.equal(select.coerce("Blue", tags), "o2", "a typed name resolves to its id");
  assert.equal(select.coerce("Green", tags), null, "an option that does not exist is not a value");
  assert.equal(select.format("o2", tags), "Blue");
  assert.equal(select.isEmpty("o1", tags), false);
  assert.equal(select.fits("is", "o2", "Blue", tags), true);
  assert.equal(select.fits("isNot", "o2", "Blue", tags), false);
});

test("renaming an option is one config write, not a cell migration", () => {
  const select = spec("select");
  const renamed = { options: [{ id: "o2", name: "Azure", color: "blue", groupId: null }] };
  assert.equal(select.format("o2", renamed), "Azure");
});

test("option order is the property's order, not the alphabet", () => {
  const select = spec("select");
  /* The arranged order moved to `order` when sorting gained a `manual` direction: two
     orders exist now, and the one the dropdown shows is not the one "A → Z" promises.
     `tags` is Red then Blue, so the two disagree — which is why this fixture can tell
     them apart at all. */
  assert.ok(select.order!("o2", "o1", tags) > 0, "Blue after Red, because a person put it there");
  assert.ok(select.compare("o2", "o1", tags) < 0, "and by name, Blue is before Red");
});

test("a multi-select takes several tags and dedupes them", () => {
  const multi = spec("multiSelect");
  assert.deepEqual(multi.coerce("Red, Blue, Red", tags), ["o1", "o2"]);
  assert.deepEqual(multi.coerce(["o2"], tags), ["o2"]);
  assert.deepEqual(multi.coerce("Purple", tags), []);
  assert.equal(multi.format(["o1", "o2"], tags), "Red, Blue");
  assert.equal(multi.isEmpty([], tags), true);
  assert.equal(multi.fits("contains", ["o1", "o2"], "Red", tags), true);
  assert.equal(multi.fits("is", ["o1", "o2"], "Red", tags), false, "'is' means exactly that one");
  assert.equal(multi.fits("doesNotContain", ["o2"], "Red", tags), true);
});

const workflow = {
  groups: [
    { id: "g1", name: "To-do", color: "gray" },
    { id: "g2", name: "In progress", color: "blue" },
    { id: "g3", name: "Complete", color: "green" },
  ],
  options: [
    { id: "s1", name: "Not started", color: "gray", groupId: "g1" },
    { id: "s2", name: "Doing", color: "blue", groupId: "g2" },
    { id: "s3", name: "Done", color: "green", groupId: "g3" },
    { id: "s4", name: "Later", color: "gray", groupId: "g1" },
  ],
};

test("a status sorts by group, then by its place inside the group", () => {
  const status = spec("status");
  assert.ok(status.order!("s1", "s2", workflow) < 0, "To-do before In progress");
  assert.ok(status.order!("s1", "s4", workflow) < 0, "inside To-do, as arranged");
  assert.ok(status.order!("s3", "s2", workflow) > 0, "Complete last");
});

test("a status filter may name a group, because that is the question people ask", () => {
  const status = spec("status");
  assert.equal(status.fits("is", "s1", "To-do", workflow), true);
  assert.equal(status.fits("is", "s4", "To-do", workflow), true, "both To-do options match");
  assert.equal(status.fits("is", "s2", "To-do", workflow), false);
  assert.equal(status.fits("is", "s2", "Doing", workflow), true, "an option name still matches");
});

test("status groups are data, so a new group needs no code", () => {
  const status = spec("status");
  const extended = {
    groups: [{ id: "g1", name: "To-do", color: "gray" }, { id: "g9", name: "Blocked", color: "red" }],
    options: [
      { id: "s1", name: "Not started", color: "gray", groupId: "g1" },
      { id: "s9", name: "Waiting", color: "red", groupId: "g9" },
    ],
  };
  assert.equal(status.fits("is", "s9", "Blocked", extended), true);
  assert.ok(status.compare("s1", "s9", extended) < 0);
});

/* ---------------------------------------------------------------------------
   Date
   --------------------------------------------------------------------------- */

test("a date is stored floating — a filter must never shift a day", () => {
  const date = spec("date");
  assert.deepEqual(date.coerce("2026-10-30", {}), { start: "2026-10-30", end: null });
  assert.deepEqual(date.coerce({ start: "2026-10-30", end: "2026-11-02" }, {}), { start: "2026-10-30", end: "2026-11-02" });
  assert.ok(!JSON.stringify(date.coerce("2026-10-30", {})).includes("Z"), "no timezone is written into a chosen date");
});

test("an end before the start is dropped rather than stored backwards", () => {
  const date = spec("date");
  assert.deepEqual(date.coerce({ start: "2026-10-30", end: "2026-10-01" }, {}), { start: "2026-10-30", end: null });
});

test("a date renders in the format the property asks for", () => {
  const date = spec("date");
  assert.equal(date.format({ start: "2026-10-30", end: null }, { format: "iso" }), "2026-10-30");
  assert.equal(date.format({ start: "2026-10-30", end: null }, { format: "dmy" }), "30/10/2026");
  assert.equal(date.format({ start: "2026-10-30", end: null }, { format: "mdy" }), "10/30/2026");
  assert.equal(date.format({ start: "2026-10-30", end: null }, { format: "long" }), "30 Oct 2026");
  assert.equal(
    date.format({ start: "2026-10-30T14:30", end: null }, { includeTime: true, timeFormat: "24" }),
    "2026-10-30 14:30",
  );
  assert.equal(
    date.format({ start: "2026-10-30T14:30", end: null }, { includeTime: true, timeFormat: "12" }),
    "2026-10-30 2:30 PM",
  );
});

test("a same-day range is the wishlist's '8 hours on one day'", () => {
  const date = spec("date");
  const meeting = date.coerce({ start: "2026-10-30T09:00", end: "2026-10-30T17:00" }, {});
  assert.deepEqual(meeting, { start: "2026-10-30T09:00", end: "2026-10-30T17:00" });
  /* The date is said once. This used to be `2026-10-30 09:00 → 2026-10-30 17:00`, which
     spends the cell's width restating a day it just named — and the picker now draws this
     exact value as its own preview, so the two must agree. `tests/database-dates.test.ts`
     pins the collapse, and the multi-day form beside it. */
  assert.equal(date.format(meeting, { includeTime: true, timeFormat: "24" }), "2026-10-30 09:00 → 17:00");
});

test("a bare date in a filter means the whole day", () => {
  const date = spec("date");
  assert.equal(date.fits("is", { start: "2026-10-30T14:30", end: null }, "2026-10-30", {}), true);
  assert.equal(date.fits("onOrAfter", { start: "2026-10-30", end: null }, "2026-10-30", {}), true);
  assert.equal(date.fits("onOrBefore", { start: "2026-10-31", end: null }, "2026-10-30", {}), false);
});

test("dates sort chronologically with empties last", () => {
  const date = spec("date");
  assert.ok(date.compare({ start: "2026-10-30", end: null }, { start: "2026-11-01", end: null }, {}) < 0);
  assert.equal(date.compare(null, { start: "2026-11-01", end: null }, {}), 1);
});

/* ---------------------------------------------------------------------------
   Person, Files, Place, Created time, Button, Formula
   --------------------------------------------------------------------------- */

test("a person is stored as a list even though there is one user", () => {
  const person = spec("person");
  assert.deepEqual(person.coerce("u1", { limit: 1 }), [{ id: "u1", name: "u1" }]);
  assert.deepEqual(
    person.coerce([{ id: "u1", name: "Preston" }, { id: "u2", name: "Ada" }], { limit: 1 }),
    [{ id: "u1", name: "Preston" }],
    "the limit is enforced at the write path",
  );
  assert.equal(person.format([{ id: "u1", name: "Preston" }], {}), "Preston");
  assert.equal(person.fits("contains", [{ id: "u1", name: "Preston" }], "Preston", {}), true);
});

test("files store references, never bytes", () => {
  const files = spec("files");
  const cell = files.coerce([{ id: "f1", name: "photo.jpg", mime: "image/jpeg", size: 2048 }], {});
  assert.deepEqual(cell, [{ id: "f1", name: "photo.jpg", mime: "image/jpeg", size: 2048 }]);
  assert.equal(JSON.stringify(cell).includes("data:"), false, "a cell must never carry a data URL");
  assert.equal(files.format(cell, {}), "photo.jpg");
  assert.equal(files.isEmpty([], {}), true);
});

test("a place accepts an address, and tolerates a widened shape", () => {
  const place = spec("place");
  assert.equal(place.coerce("12 Rue de Rivoli, Paris", {}), "12 Rue de Rivoli, Paris");
  assert.equal(place.coerce({ address: "12 Rue de Rivoli" }, {}), "12 Rue de Rivoli");
  assert.equal(place.coerce("   ", {}), null);
  assert.equal(place.fits("contains", "12 Rue de Rivoli, Paris", "paris", {}), true);
});

test("created time refuses every write, because a row must not forge its own age", () => {
  const created = spec("createdTime");
  assert.equal(created.readOnly, true);
  assert.equal(created.coerce("2026-01-01T00:00:00.000Z", {}), null);
  assert.equal(created.coerce(12345, {}), null);
});

test("created time renders the instant it was actually created", () => {
  const created = spec("createdTime");
  /* Built from local components so the assertion does not depend on the machine's zone. */
  const instant = new Date(2026, 9, 30, 14, 5).toISOString();
  assert.equal(created.format(instant, { includeTime: true }), "2026-10-30 14:05");
  assert.equal(created.format(instant, { includeTime: false }), "2026-10-30");
});

test("a button column has no value, only an action", () => {
  const button = spec("button");
  assert.equal(button.readOnly, true);
  assert.equal(button.coerce("anything", {}), null);
  assert.equal(button.isEmpty(null, {}), true);
  assert.equal(button.format(null, { label: "Send invoice" }), "", "the label is the control's, not the value's");
});

test("a formula is derived, numeric, and never stored", () => {
  const formula = spec("formula");
  assert.equal(formula.derived, true);
  assert.equal(formula.coerce("42", {}), 42);
  assert.equal(formula.format(12.5, {}), "12.5");
  assert.equal(formula.format(12, {}), "12");
  assert.equal(formula.isEmpty(null, {}), true);
  assert.ok(formula.compare(2, 10, {}) < 0, "formulas sort numerically, not alphabetically");
  assert.equal(formula.fits("greaterThan", 10, 2, {}), true);
});

/* ---------------------------------------------------------------------------
   The read-only / derived flags exist so the write path can refuse, not so a
   view can special-case. Both are asserted here because a regression in either
   is silent.
   --------------------------------------------------------------------------- */

test("exactly two types are read-only and exactly one is derived", () => {
  const readOnly = propertyTypes.filter((type) => spec(type).readOnly === true).sort();
  assert.deepEqual(readOnly, ["button", "createdTime"]);
  const derived = propertyTypes.filter((type) => spec(type).derived === true);
  assert.deepEqual(derived, ["formula"]);
});

test("formatCell is the only door a view needs, and it never throws", () => {
  for (const type of propertyTypes) {
    assert.doesNotThrow(() => formatCell({ type, config: {} }, null), `${type} threw on an empty cell`);
    assert.equal(formatCell({ type, config: {} }, null), "", `${type} rendered an empty cell as text`);
  }
});

/* ---------------------------------------------------------------------------
   How a sort explains itself.

   "A → Z" is a claim about the comparison. It was written once, in the property
   menu, and it was wrong for eight of the sixteen types — a number column sorted
   ascending is not A to Z. The wording and the glyph (`sortKind`) now come from the
   type, and these assertions are what stop the two drifting back into the menu.
   --------------------------------------------------------------------------- */

test("a sort is described in the terms its type actually compares by", () => {
  assert.deepEqual(sortLabels("number"), { ascending: "Low → High", descending: "High → Low" });
  assert.deepEqual(sortLabels("date"), { ascending: "Earliest → Latest", descending: "Latest → Earliest" });
  assert.deepEqual(sortLabels("createdTime"), { ascending: "Earliest → Latest", descending: "Latest → Earliest" });
  assert.deepEqual(sortLabels("checkbox"), { ascending: "Unchecked first", descending: "Checked first" });
  assert.deepEqual(sortLabels("text"), { ascending: "A → Z", descending: "Z → A" });
  /* A tag column is the one place a third order exists, and the label is *added* to the
     alphabetical pair rather than replacing it — both are real and they disagree. */
  assert.deepEqual(sortLabels("select"), { ascending: "A → Z", descending: "Z → A", manual: "Manual order" });
});

test("every type both names its sort and classifies it, and no label says A to Z wrongly", () => {
  for (const type of propertyTypes) {
    const labels = sortLabels(type);
    assert.ok(labels.ascending.length > 0 && labels.descending.length > 0, `${type} has no sort labels`);
    assert.notEqual(labels.ascending, labels.descending, `${type} names both directions the same`);
    assert.ok(["alpha", "ordered"].includes(sortKind(type)), `${type} has no sort kind`);
  }
  /* The ordered kinds are exactly the types that do not compare as text. Sorted, so
     the assertion names the set rather than the order the registry happens to have. */
  const ordered = propertyTypes.filter((type) => sortKind(type) === "ordered").sort();
  assert.deepEqual(ordered, ["checkbox", "createdTime", "date", "number"]);
});

test("the number formats offered are the number formats the schema stores", () => {
  /* `currency` is deliberately absent from `numberFormatChoices`: it is chosen in the
     same submenu from a list of currencies, so offering it as a bare "Currency" row
     would set a format with no currency. Every *other* format must be reachable. */
  const offered = numberFormatChoices.map((choice) => choice.format);
  const missing = numberFormats.filter((format) => format !== "currency" && !offered.includes(format));
  assert.deepEqual(missing, [], "a format the config can hold has no menu row");
  assert.deepEqual(offered, ["number", "separators", "percent", "duration"], "menu order changed");
});

test("a currency code renders the symbol the cell will show, and an unknown one does not throw", () => {
  for (const entry of currencies) {
    const symbol = currencySymbol(entry.code);
    assert.ok(symbol.length > 0, `${entry.code} has no symbol`);
    assert.equal(typeof symbol, "string");
  }
  /* The same code twice must give the same glyph, or the menu and the cell disagree. */
  assert.equal(currencySymbol("EUR"), currencySymbol("EUR"));
  assert.equal(currencySymbol("NOTACODE"), "NOTACODE", "an unknown code falls back to itself");
  /* And the symbol is the one the *formatter* uses, not a second opinion. */
  const formatted = formatCell({ type: "number", config: { format: "currency", currency: "EUR", decimals: 0 } }, 1234);
  assert.ok(formatted.includes(currencySymbol("EUR")), `"${formatted}" does not contain the menu's symbol`);
});

test("number presentation is presentation: the stored value is untouched", () => {
  const cell = (config: Record<string, unknown>) => formatCell({ type: "number", config }, 1234.5);
  assert.equal(cell({ format: "number", decimals: 0 }), "1235");
  assert.equal(cell({ format: "number", decimals: 2 }), "1234.50");
  assert.equal(cell({ format: "separators", decimals: 0 }), new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(1234.5));
  assert.equal(cell({ format: "percent", decimals: 0 }), "1235%");
  assert.equal(cell({ format: "duration", decimals: 0 }), "20m 35s");
  assert.equal(cell({ format: "currency", currency: "USD", decimals: 2 }), new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1234.5));
  /* Two settings, one value: the decimal count must not survive a format change as a
     rounded *stored* number. */
  const spec = resolveProperty({ type: "number" });
  assert.equal(spec.coerce("1234.567", { decimals: 0 }), 1234.567);
});
