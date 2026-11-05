// Why something failed, as a kind the code can decide on, beside the words a person reads. Whatever detects a failure sets
// the kind where it knows (a process that exited 127, an HTTP 401, a connection that dropped, an answer that does not
// decode); nothing downstream reads the words to find out.
import type { FailureKind } from '../types'

/** An error that carries its kind. */
export class Failure extends Error {
  readonly kind: FailureKind

  constructor(kind: FailureKind, message: string) {
    super(message)
    this.name = 'Failure'
    this.kind = kind
  }
}

/** What kind of failure `error` is; an error nobody classified is `unknown`. */
export const kindOf = (error: unknown): FailureKind => (error instanceof Failure ? error.kind : 'unknown')

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** An error as a failure that keeps its kind. */
export const asFailure = (error: unknown, label = (message: string) => message): Failure => new Failure(kindOf(error), label(messageOf(error)))

/** Several failures as one, in the kind of the first, with their words joined. */
export const together = (list: readonly Failure[]): Failure => new Failure(list[0]?.kind ?? 'unknown', list.map(one => one.message).join('; '))
