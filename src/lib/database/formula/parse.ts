import { FormulaSyntaxError } from "./errors";
import { tokenize, type Token } from "./tokenize";

/**
 * The formula grammar, part two: tokens into a tree.
 * ---------------------------------------------------------------------------
 * A Pratt parser, because the whole point of an expression language is precedence and
 * a table is a clearer statement of it than seven mutually recursive functions:
 *
 *   ||            or
 *   &&            and
 *   == !=         comparison
 *   > >= < <=     ordering
 *   + -           sum
 *   * / %         product
 *   -x !x         unary
 *   f(…) a.b      call and member
 *
 * `prop("Due")`, `Date.dateAdd(prop("Due"), 1, "weeks")` and `lets({a: 1}, a + 1)` are
 * all just calls: there is no special syntax for a property reference, which is why a
 * property named after a function still works and why the editor can insert one by
 * inserting a *call*.
 */

export type Node =
  | { kind: "number"; value: number; at: number }
  | { kind: "string"; value: string; at: number }
  | { kind: "boolean"; value: boolean; at: number }
  | { kind: "name"; name: string; at: number }
  | { kind: "list"; items: Node[]; at: number }
  | { kind: "object"; entries: Array<{ key: string; value: Node }>; at: number }
  | { kind: "call"; callee: Node; args: Node[]; at: number }
  | { kind: "member"; object: Node; name: string; at: number }
  | { kind: "unary"; op: "-" | "!"; value: Node; at: number }
  | { kind: "binary"; op: string; left: Node; right: Node; at: number };

const BINARY: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3, "!=": 3,
  ">": 4, ">=": 4, "<": 4, "<=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
};

class Parser {
  private at = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.at + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== "end") this.at += 1;
    return token;
  }

  private accept(text: string): boolean {
    const token = this.peek();
    if (token.text === text && (token.kind === "punctuation" || token.kind === "operator")) {
      this.at += 1;
      return true;
    }
    return false;
  }

  private expect(text: string, what: string): Token {
    const token = this.peek();
    if (token.text !== text) {
      throw new FormulaSyntaxError(
        token.kind === "end" ? `I expected ${what} but the formula ends here` : `I expected ${what}, not ${JSON.stringify(token.text)}`,
        token.start,
      );
    }
    this.at += 1;
    return token;
  }

  parse(): Node {
    const node = this.expression(0);
    const trailing = this.peek();
    if (trailing.kind !== "end") {
      throw new FormulaSyntaxError(`There is more here than one expression (${JSON.stringify(trailing.text)})`, trailing.start);
    }
    return node;
  }

  private expression(minimum: number): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      const precedence = token.kind === "operator" ? BINARY[token.text] : undefined;
      if (precedence === undefined || precedence < minimum) break;
      this.next();
      /* `minimum + 1` makes the operators left-associative: `1 - 2 - 3` is `(1-2)-3`,
         which is the reading every calculator on earth has taught people. */
      const right = this.expression(precedence + 1);
      left = { kind: "binary", op: token.text, left, right, at: token.start };
    }
    return left;
  }

  private unary(): Node {
    const token = this.peek();
    if (token.kind === "operator" && (token.text === "-" || token.text === "!")) {
      this.next();
      return { kind: "unary", op: token.text, value: this.unary(), at: token.start };
    }
    return this.postfix();
  }

  private postfix(): Node {
    let node = this.primary();
    for (;;) {
      const token = this.peek();
      if (token.text === "." && token.kind === "punctuation") {
        this.next();
        const name = this.next();
        if (name.kind !== "name") throw new FormulaSyntaxError("I expected a name after the dot", name.start);
        node = { kind: "member", object: node, name: name.text, at: name.start };
        continue;
      }
      if (token.text === "(" && token.kind === "punctuation") {
        this.next();
        node = { kind: "call", callee: node, args: this.arguments(), at: token.start };
        continue;
      }
      break;
    }
    return node;
  }

  private arguments(): Node[] {
    const args: Node[] = [];
    if (this.accept(")")) return args;
    for (;;) {
      args.push(this.expression(0));
      if (this.accept(",")) continue;
      this.expect(")", "a closing parenthesis");
      return args;
    }
  }

  private primary(): Node {
    const token = this.next();
    switch (token.kind) {
      case "number": return { kind: "number", value: Number(token.value), at: token.start };
      case "string": return { kind: "string", value: String(token.value ?? ""), at: token.start };
      case "name":
        if (token.text === "true" || token.text === "false") return { kind: "boolean", value: token.text === "true", at: token.start };
        return { kind: "name", name: token.text, at: token.start };
      case "end":
        throw new FormulaSyntaxError("The formula is not finished", token.start);
      default: break;
    }
    if (token.text === "(") {
      const inner = this.expression(0);
      this.expect(")", "a closing parenthesis");
      return inner;
    }
    if (token.text === "[") {
      const items: Node[] = [];
      if (!this.accept("]")) {
        for (;;) {
          items.push(this.expression(0));
          if (this.accept(",")) continue;
          this.expect("]", "a closing bracket");
          break;
        }
      }
      return { kind: "list", items, at: token.start };
    }
    if (token.text === "{") {
      const entries: Array<{ key: string; value: Node }> = [];
      if (!this.accept("}")) {
        for (;;) {
          const key = this.next();
          if (key.kind !== "name" && key.kind !== "string") throw new FormulaSyntaxError("A name is needed before the colon", key.start);
          this.expect(":", "a colon after the name");
          entries.push({ key: String(key.kind === "string" ? key.value : key.text), value: this.expression(0) });
          if (this.accept(",")) continue;
          this.expect("}", "a closing brace");
          break;
        }
      }
      return { kind: "object", entries, at: token.start };
    }
    throw new FormulaSyntaxError(`I can't start an expression with ${JSON.stringify(token.text)}`, token.start);
  }
}

export function parseFormula(source: string): Node {
  return new Parser(tokenize(source)).parse();
}

/**
 * The parse cache. A formula is parsed once and evaluated per row, and a table with
 * 400 rows and three formula columns would otherwise tokenise the same string 1200
 * times per read. Keyed by the expression text itself, so editing the formula is a new
 * key with no invalidation to get wrong.
 */
const CACHE = new Map<string, Node>();
const CACHE_LIMIT = 500;

export function compileFormula(source: string): Node {
  const cached = CACHE.get(source);
  if (cached) return cached;
  const node = parseFormula(source);
  /* Clearing rather than evicting in order: the entries are cheap to rebuild and a
     clock-based eviction would be a second thing to test for no benefit. */
  if (CACHE.size >= CACHE_LIMIT) CACHE.clear();
  CACHE.set(source, node);
  return node;
}

/** The dotted name a call refers to, when it is a plain `name` or `Name.member`. Used
 *  to find the function a call means without evaluating the callee. */
export function callName(node: Node): string | null {
  if (node.kind === "name") return node.name;
  if (node.kind === "member" && node.object.kind === "name") return `${node.object.name}.${node.name}`;
  return null;
}
