import { FormulaSyntaxError } from "./errors";

/**
 * The formula grammar, part one: text into tokens.
 * ---------------------------------------------------------------------------
 * The language is a *tiny expression language*, not JavaScript, and it is tokenised
 * and parsed here because the alternative — `new Function(expression)` — is code
 * execution from a cell, on a server that also holds an API. Nothing in this
 * directory ever hands user text to the runtime's evaluator.
 *
 * The tokens are also what the editor's syntax highlighting paints, so they carry
 * their source offsets: one tokenizer for the language and for the colours means the
 * two can never disagree about where a string literal starts.
 */

export type TokenKind = "number" | "string" | "name" | "punctuation" | "operator" | "end";

export interface Token {
  kind: TokenKind;
  /** Exactly the source text of the token, so the highlighter can re-emit it. */
  text: string;
  start: number;
  end: number;
  /** The decoded value for `string`, the numeric value for `number`. */
  value?: string | number;
}

const PUNCTUATION = "()[]{},.:";
const OPERATORS = ["==", "!=", ">=", "<=", "&&", "||", "+", "-", "*", "/", "%", ">", "<", "!"];
const NAME = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const NUMBER = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'" };

export function tokenize(source: string, lenient = false): Token[] {
  const tokens: Token[] = [];
  let at = 0;

  while (at < source.length) {
    const character = source[at];

    if (/\s/.test(character)) { at += 1; continue; }

    if (character === '"' || character === "'") {
      const quote = character;
      let cursor = at + 1;
      let text = "";
      let closed = false;
      while (cursor < source.length) {
        const next = source[cursor];
        if (next === "\\") {
          const escaped = source[cursor + 1];
          if (escaped === undefined) break;
          /* An unknown escape keeps its backslash: `"\d"` is a regex in a formula, and
             `"C:\Users"` is a path in a formula. Dropping the slash silently turns the
             first into a letter and the second into nonsense. */
          text += ESCAPES[escaped] ?? `\\${escaped}`;
          cursor += 2;
          continue;
        }
        if (next === quote) { closed = true; cursor += 1; break; }
        text += next;
        cursor += 1;
      }
      if (!closed && !lenient) throw new FormulaSyntaxError(`The text starting here is never closed with ${quote}`, at);
      tokens.push({ kind: "string", text: source.slice(at, cursor), value: text, start: at, end: cursor });
      at = cursor;
      continue;
    }

    if (/\d/.test(character)) {
      NUMBER.lastIndex = at;
      const match = NUMBER.exec(source);
      if (match) {
        tokens.push({ kind: "number", text: match[0], value: Number(match[0]), start: at, end: at + match[0].length });
        at += match[0].length;
        continue;
      }
    }

    NAME.lastIndex = at;
    const name = NAME.exec(source);
    if (name) {
      tokens.push({ kind: "name", text: name[0], start: at, end: at + name[0].length });
      at += name[0].length;
      continue;
    }

    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, at));
    if (operator) {
      tokens.push({ kind: "operator", text: operator, start: at, end: at + operator.length });
      at += operator.length;
      continue;
    }

    if (PUNCTUATION.includes(character)) {
      tokens.push({ kind: "punctuation", text: character, start: at, end: at + 1 });
      at += 1;
      continue;
    }

    if (lenient) {
      /* Painting must survive a half-typed formula: the character the parser refuses is
         still on screen, and it is still one character of plain text. */
      tokens.push({ kind: "punctuation", text: character, start: at, end: at + 1 });
      at += 1;
      continue;
    }
    throw new FormulaSyntaxError(`I don't know what ${JSON.stringify(character)} means`, at);
  }

  tokens.push({ kind: "end", text: "", start: source.length, end: source.length });
  return tokens;
}
