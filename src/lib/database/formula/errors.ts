/** Two failures, because they answer two different questions.
 *
 *  `FormulaSyntaxError` is *the expression is wrong* — the same for every row, and the
 *  editor can point at a character. `FormulaFailure` is *this row could not be
 *  evaluated* — divide by zero, a date that cannot be parsed — and it names the
 *  function, not a column. A single error class would have to carry a position it
 *  often does not have, and callers would check `position === undefined` to tell them
 *  apart, which is the sort of flag that gets read backwards eventually. */

export class FormulaSyntaxError extends Error {
  constructor(message: string, readonly position: number) {
    super(message);
    this.name = "FormulaSyntaxError";
  }
}

export class FormulaFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaFailure";
  }
}

/** The one sentence at the top of the editor. Position is 0-based inside the source. */
export function syntaxMessage(error: FormulaSyntaxError): string {
  return `${error.message} (character ${error.position + 1})`;
}
