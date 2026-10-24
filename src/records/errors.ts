/** A command was refused because of what was entered; `errors` are user-facing sentences. */
export class ValidationError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(" "));
  }
}
