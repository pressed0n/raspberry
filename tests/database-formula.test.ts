import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCell } from "../src/lib/database/properties";
import { formulaProperty } from "../src/lib/database/property-types/formula";
import {
  applyFormulas,
  formulaCatalog,
  formulaText,
  previewFormula,
  runFormula,
  traceFormula,
  type FormulaValue,
} from "../src/lib/database/formula";
import { FUNCTIONS } from "../src/lib/database/formula/functions";
import { primaryPropertyId, type PropertyDef, type RowDef } from "../src/lib/database/types";

/* The owner's ask: "Lets work on the Formula property now, It currently does nothing.
   In notion when I open it, a big dropdown opens up. Analyze it, design it and develop
   all the features."

   So the tests below are the language itself — every function, every operator, every
   documented example — plus the two things a screenshot cannot prove: that the value in
   a cell and the value under "Preview with" are the same `evaluate`, and that a formula
   column is *derived* (nothing is ever written for it).

   The examples test is the one that keeps the help honest: it runs the exact code the
   editor shows and compares it to the exact result the editor prints. A function whose
   documentation stops being true fails here, not in front of the owner. */

const NOW = new Date(2026, 9, 30, 14, 30, 0);

const property = (id: string, name: string, type: PropertyDef["type"], config: Record<string, unknown> = {}): PropertyDef => ({
  id, name, type, config, position: 0,
});

const properties: PropertyDef[] = [
  property(primaryPropertyId, "Name", "text"),
  property("p-due", "Due", "date"),
  property("p-price", "Price", "number"),
  property("p-done", "Done", "checkbox"),
  property("p-status", "Status", "status", {
    options: [{ id: "s1", name: "In progress", color: "blue" }, { id: "s2", name: "Done", color: "green" }],
    groups: [],
  }),
  property("p-tags", "Tags", "multiSelect", {
    options: [{ id: "t1", name: "Design" }, { id: "t2", name: "Build" }],
  }),
  property("p-files", "Files", "files"),
];

const row: RowDef = {
  id: "r1",
  title: "Raspberry",
  icon: "",
  cells: {
    "p-due": { start: "2026-10-01" },
    "p-price": 40,
    "p-done": true,
    "p-status": "s2",
    "p-tags": ["t1", "t2"],
    "p-files": [{ id: "f1", name: "pitch.pdf", mime: "application/pdf", size: 69 }],
  },
  createdAt: "2026-01-02T09:00:00.000Z",
  updatedAt: "2026-01-02T09:00:00.000Z",
  position: 0,
};

const value = (expression: string): FormulaValue => runFormula(expression, row, properties, NOW);
const text = (expression: string): string => formulaText(value(expression));
const preview = (expression: string) => previewFormula(expression, row, properties, NOW);

test("every documented example runs, and prints what the help says it prints", () => {
  for (const definition of FUNCTIONS) {
    for (const example of definition.examples) {
      const result = preview(example.code);
      if (example.fails) {
        assert.notEqual(result.message, null, `${definition.name}: ${example.code} was supposed to fail and did not`);
        continue;
      }
      assert.equal(result.message, null, `${definition.name}: ${example.code} failed — ${result.message}`);
      if (example.result !== undefined) {
        assert.equal(result.text, example.result, `${definition.name}: ${example.code}`);
      }
    }
  }
  /* The two special forms are not in `FUNCTIONS` (the evaluator reads their first
     argument as a name), so their examples are run here instead. */
  assert.equal(text("let(total, 2 + 3, total * 2)"), "10");
  assert.equal(text("lets({a: 2, b: 3}, a * b)"), "6");
});

test("the catalogue lists the registry, not a second copy of it", () => {
  const sections = formulaCatalog([...properties, property("p-total", "Total", "formula")], "p-total");
  const titles = sections.map((section) => section.title);
  assert.deepEqual(titles, ["Properties", "Built-ins", "General", "Text", "Number", "Date", "List"]);

  const listed = sections.filter((section) => !["Properties", "Built-ins"].includes(section.title))
    .flatMap((section) => section.entries.map((entry) => entry.label));
  for (const definition of FUNCTIONS) assert.ok(listed.includes(definition.name), `${definition.name} is not in the browser`);
  assert.ok(listed.includes("let") && listed.includes("lets"), "the special forms are documented too");

  /* The property being edited is not offered: referencing it would always be a loop. */
  const propertyNames = sections[0].entries.map((entry) => entry.label);
  assert.ok(!propertyNames.includes("Total"), "a formula must not be referenceable from itself");
  assert.ok(propertyNames.includes("Due"));
  assert.equal(sections[0].entries.find((entry) => entry.label === "Due")?.insert, 'prop("Due")');
});

test("a property reference reads a value in the shape the functions understand", () => {
  assert.equal(formulaText(value('prop("Name")')), "Raspberry");
  assert.equal(formulaText(value('prop("Price")')), "40");
  assert.equal(formulaText(value('prop("Done")')), "Yes");
  /* A select stores an option id; a formula reads the name, so renaming an option does
     not break a formula that mentions it. */
  assert.equal(formulaText(value('prop("Status")')), "Done");
  assert.equal(formulaText(value('prop("Tags")')), "Design, Build");
  assert.equal(formulaText(value('prop("Files")')), "pitch.pdf");
  assert.equal(formulaText(value('year(prop("Due"))')), "2026");
  /* Lower case reads the same property: a formula typed by hand should not fail on case. */
  assert.equal(formulaText(value('prop("price")')), "40");
});

test("arithmetic, precedence and the operators that refuse to guess", () => {
  assert.equal(text("2 + 3 * 4"), "14");
  assert.equal(text("(2 + 3) * 4"), "20");
  assert.equal(text("10 - 2 - 3"), "5");
  assert.equal(text("-4 + 1"), "-3");
  assert.equal(text("7 % 3"), "1");
  assert.equal(text("2 + 3 > 4"), "Yes");
  assert.equal(text("1 == 1"), "Yes");
  assert.equal(text('"a" == "a"'), "Yes");
  /* A text cell holding a number adds up, and a text cell holding a word says so:
     `"2" + 1` is 3, never `"21"` — implicit concatenation is the classic bug this
     language refuses, and `concat()` is what joining is for. */
  assert.equal(text('"2" + 1'), "3");
  assert.match(preview('"two" + 1').message ?? "", /needs numbers/);
  assert.match(preview("1 / 0").message ?? "", /divide by zero/);
  assert.match(preview('1 > "later"').message ?? "", /same kind/);

  /* An empty cell is *nothing*, not the wrong type. A row with no price reads blank in a
     formula column; it does not paint an error over the four rows that are fine. */
  const empty = { ...row, cells: {} };
  assert.equal(formulaText(runFormula('prop("Price") * 2', empty, properties, NOW)), "");
  assert.equal(formulaText(runFormula('add(prop("Price"), 2)', empty, properties, NOW)), "");
  assert.equal(formulaText(runFormula('-prop("Price")', empty, properties, NOW)), "");
  assert.equal(formulaText(runFormula('prop("Price") > 10', empty, properties, NOW)), "No");
  /* …but a text cell where a number belongs is still a mistake, and still says so. */
  assert.match(preview('prop("Name") * 2').message ?? "", /needs numbers/);
});

test("a syntax error says where it is; a row error says what broke", () => {
  const broken = preview("add(1, ");
  assert.match(broken.message ?? "", /not finished/);
  assert.equal(typeof broken.position, "number");
  assert.equal(broken.type, "unknown");
  assert.match(preview("add(1, 2) +").message ?? "", /not finished/);
  assert.match(preview('"unclosed').message ?? "", /never closed/);

  const unknown = preview("nope(1)");
  assert.match(unknown.message ?? "", /no function called nope/);

  const arity = preview("add(1)");
  assert.match(arity.message ?? "", /takes 2 arguments/);

  const missing = preview('prop("Colour")');
  assert.match(missing.message ?? "", /no property called "Colour"/);

  /* A bare name is the mistake people make first, and the message names the fix. */
  assert.match(preview("Price + 1").message ?? "", /prop\("Price"\)/);
});

test("strings keep their backslashes, so a regex and a path both survive", () => {
  assert.equal(text('"a\\nb"'), "a\nb");
  assert.equal(text('"a\\"b"'), 'a"b');
  assert.equal(text('"\\d+"'), "\\d+");
  assert.equal(text('test("a1", "\\d")'), "Yes");
  assert.equal(text('lower("HeLLo")'), "hello");
});

test("a checkbox result prints as Yes or No, and a list prints as a sentence", () => {
  assert.equal(text("true"), "Yes");
  assert.equal(text("false"), "No");
  assert.equal(text("and(true, true)"), "Yes");
  assert.equal(text('split("a,b", ",")'), "a, b");
  assert.equal(text("[]"), "");
});

test("a date is the same record a Date column stores, so everything else already handles it", () => {
  const result = value('dateAdd(prop("Due"), 7, "days")');
  assert.deepEqual(result, { start: "2026-10-08" });
  assert.equal(formatCell({ type: "formula", config: {} }, result as never), "October 8, 2026");
  /* A range is kept, end and all. */
  const range = runFormula('prop("Span")', { ...row, cells: { "p-span": { start: "2026-10-01", end: "2026-10-03" } } },
    [...properties, property("p-span", "Span", "date")], NOW);
  assert.deepEqual(range, { start: "2026-10-01", end: "2026-10-03" });
});

test("lazy branches: a guard runs before the thing it guards", () => {
  assert.equal(text('if(prop("Done"), "finished", "open")'), "finished");
  /* The unused branch never runs, so a division by zero in it cannot fail the row. */
  assert.equal(text('if(false, 1 / 0, 2)'), "2");
  assert.equal(text("and(false, 1 / 0)"), "No");
  assert.equal(text("or(true, 1 / 0)"), "Yes");
  const empty = runFormula('if(prop("Missing"), 1, 2)', { ...row, cells: {} }, [...properties, property("p-missing", "Missing", "number")], NOW);
  assert.equal(empty, 2);
});

test("a formula may read another formula, and a loop is an error rather than a hang", () => {
  const withFormulas: PropertyDef[] = [
    ...properties,
    property("p-a", "A", "formula", { expression: 'prop("Price") * 2' }),
    property("p-b", "B", "formula", { expression: 'prop("A") + 1' }),
  ];
  assert.equal(formulaText(runFormula('prop("B")', row, withFormulas, NOW)), "81");

  const loop: PropertyDef[] = [
    ...properties,
    property("p-x", "X", "formula", { expression: 'prop("Y")' }),
    property("p-y", "Y", "formula", { expression: 'prop("X")' }),
  ];
  const [filled] = applyFormulas(loop, [row], NOW);
  assert.match(String((filled.cells["p-x"] as { __error?: string }).__error ?? ""), /depends on itself/);
});

test("applyFormulas fills the derived cells and writes nothing for anything else", () => {
  const withFormula: PropertyDef[] = [
    ...properties,
    property("p-total", "Total", "formula", { expression: 'prop("Price") + 2' }),
    property("p-empty", "Empty", "formula", {}),
  ];
  const [filled] = applyFormulas(withFormula, [row], NOW);
  assert.equal(filled.cells["p-total"], 42);
  assert.ok(!("p-empty" in filled.cells), "an expression that is not written yet produces no cell");
  assert.equal(filled.cells["p-price"], 40, "the source cells are untouched");
  assert.equal(formatCell(withFormula[withFormula.length - 2], filled.cells["p-total"]), "42");

  /* A broken expression becomes a readable sentence in the cell, not an empty column. */
  const broken: PropertyDef[] = [...properties, property("p-bad", "Bad", "formula", { expression: "add(1, " })];
  const [flagged] = applyFormulas(broken, [row], NOW);
  assert.match(formatCell(broken[broken.length - 1], flagged.cells["p-bad"]), /not finished/);

  /* No formula columns: the very same rows come back, so a table pays nothing. */
  assert.equal(applyFormulas(properties, [row], NOW)[0], row);
});

test("the formula spec compares, filters and empties by the value's own kind", () => {
  const compare = (a: unknown, b: unknown) => formulaProperty.compare(a as never, b as never, {});
  assert.ok(compare(1, 2) < 0);
  assert.ok(compare("b", "a") > 0);
  assert.ok(compare({ start: "2026-01-01" }, { start: "2026-02-01" }) < 0);
  /* Empty sorts last whatever the kind, which is what every other column does. */
  assert.ok(compare(null, 1) > 0);
  assert.ok(compare(1, null) < 0);
  /* Different kinds still have one stable order rather than a random one. */
  assert.ok(compare(9, "a") < 0);

  const isEmpty = (value: unknown) => formulaProperty.isEmpty(value as never, {});
  assert.equal(isEmpty(null), true);
  assert.equal(isEmpty(""), true);
  assert.equal(isEmpty([]), true);
  assert.equal(isEmpty(0), false);
  assert.equal(isEmpty(false), false);

  const fits = (operator: "contains" | "isEmpty" | "isNotEmpty" | "greaterThan" | "is", value: unknown, operand: unknown) =>
    formulaProperty.fits(operator, value as never, operand, {});
  assert.equal(fits("contains", "Raspberry", "asp"), true);
  assert.equal(fits("isEmpty", null, ""), true);
  assert.equal(fits("isNotEmpty", 42, ""), true);
  assert.equal(fits("greaterThan", 42, 10), true);
  assert.equal(fits("is", { start: "2026-10-30" }, "2026-10-30"), true);
  assert.equal(formulaProperty.derived, true, "a formula is never written");
});

test("debug mode reports the values the evaluator actually produced", () => {
  const trace = traceFormula('dateBetween(prop("Due"), now(), "days")', row, properties, NOW);
  assert.ok(trace.length >= 4);
  const last = trace[trace.length - 1];
  assert.equal(last.type, "number");
  assert.equal(last.text, "29");
  /* Leaves come before the calls that used them. */
  const due = trace.find((entry) => entry.label === 'prop("Due")');
  assert.equal(due?.type, "date");
  assert.ok(trace.some((entry) => entry.label === '"days"'));
});
