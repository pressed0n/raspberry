import { findFunction } from "./functions";
import { tokenize, type Token } from "./tokenize";

/**
 * Syntax colour, as data.
 * ---------------------------------------------------------------------------
 * The editor paints a formula by putting this list in a `<pre>` under a transparent
 * `<textarea>`. It uses the *same* tokenizer the parser does, so the colours cannot
 * disagree with the language about where a string starts — and it asks the registry
 * whether a name is a function, so a typo is a different colour from a call without a
 * second list of names to keep in step.
 *
 * Lenient tokenisation is deliberate: the interesting moment for colour is halfway
 * through typing `"hello`, and a highlighter that gave up exactly then would be a
 * highlighter that flashes white on every string.
 */

export type PaintKind = "plain" | "name" | "function" | "property" | "string" | "number" | "literal" | "operator" | "punctuation";

export interface PaintSpan { text: string; kind: PaintKind }

const NAME_AT = (tokens: Token[], index: number) => (tokens[index]?.kind === "name" ? tokens[index].text : null);

export function paintFormula(source: string): PaintSpan[] {
  if (source === "") return [];
  const tokens = tokenize(source, true);
  const spans: PaintSpan[] = [];
  let at = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === "end") break;
    /* Whitespace never reaches the token stream, so it is re-emitted here: dropping it
       would make the coloured text narrower than the field above it and the caret would
       drift away from the word it is in. */
    if (token.start > at) spans.push({ text: source.slice(at, token.start), kind: "plain" });
    spans.push({ text: token.text, kind: kindOf(tokens, index) });
    at = token.end;
  }
  if (at < source.length) spans.push({ text: source.slice(at), kind: "plain" });
  return spans;
}

function kindOf(tokens: Token[], index: number): PaintKind {
  const token = tokens[index];
  switch (token.kind) {
    case "number": return "number";
    case "string": {
      /* The one argument of `prop(` is a *column*, and colouring it like a string literal
         would hide the only part of the formula that points at the table. */
      const open = tokens[index - 1];
      const name = tokens[index - 2];
      return open?.text === "(" && name?.kind === "name" && name.text === "prop" ? "property" : "string";
    }
    case "operator": return "operator";
    case "punctuation": return "punctuation";
    case "name": {
      if (token.text === "true" || token.text === "false") return "literal";
      if (findFunction(token.text)) return "function";
      const dot = tokens[index + 1];
      const member = NAME_AT(tokens, index + 2);
      if (dot?.text === "." && member && findFunction(`${token.text}.${member}`)) return "function";
      const next = tokens[index + 1];
      return next?.text === "(" ? "function" : "name";
    }
    default: return "plain";
  }
}
