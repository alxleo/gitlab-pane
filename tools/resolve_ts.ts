// Lets Node run the core from source. `claude plugin validate` type-checks hooks/, types/ and tests/ with the engine's own
// compiler options, which refuse an import path ending in `.ts`, so the files there import each other without one. Node finds
// a relative module only by its whole file name, so every Node that runs the core from source loads this first:
//
//   node --import ./tools/resolve_ts.ts tools/<tool>.ts
//
// A relative import Node cannot find is tried again with `.ts`; when that is missing too, Node's own error stands. It
// imports no file of the repository, since none can be found before it runs.
import { registerHooks } from 'node:module'
import type { ResolveHookSync } from 'node:module'

/** Whether Node refused `error` because no file answers the import. */
const isNotFound = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND'

/** Node's resolution, and for a relative import it cannot find, the same with `.ts`; Node's own error when that is missing too. */
export const resolveTs: ResolveHookSync = (specifier, context, nextResolve) => {
  try {
    return nextResolve(specifier, context)
  } catch (error) {
    if (!isNotFound(error) || !(specifier.startsWith('./') || specifier.startsWith('../'))) {
      throw error
    }
    try {
      return nextResolve(`${specifier}.ts`, context)
    } catch {
      throw error
    }
  }
}

registerHooks({ resolve: resolveTs })
