// No comment that changes what a linter does: a rule is switched or tuned in oxlint.config.ts, with its reason beside it, and
// never by a comment next to the code, where nobody reviews the rule. tools/check_files.ts runs this over every script the
// repository holds. It is not a lint rule because oxlint obeys `/* oxlint-disable */` even when the rule it silences is the
// one that refuses such comments. TypeScript's `@ts-…` comments are refused by the lint rule `typescript/ban-ts-comment`.
import { parseSync } from 'oxc-parser'

/** The files a directive could steer: JavaScript and TypeScript, modules and scripts. */
export const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/u

// oxlint's and ESLint's switches, in any comment: `oxlint-disable`, `-disable-line`, `-disable-next-line`, `-enable`, and
// ESLint's `eslint-env`. Matched without regard to case, which is wider than either linter reads them.
const SWITCH = /^\s*(?:eslint|oxlint)-(?:disable(?:-next-line|-line)?|enable|env)(?:\s|$)/iu
// What ESLint reads from block comments only: rule settings (`/* eslint no-console: off */`) and its declarations
// (`/* global a */`, `/* globals a */`, `/* exported a */`). In a line comment the same first word is prose, and oxlint
// reads no settings from `/* oxlint … */`, so that is prose too.
const BLOCK = /^\s*(?:eslint|globals?|exported)(?:\s|$)/iu

/** Each linter directive among the comments of a script, as `file:line: what`. Strings and code are not comments. */
export function directivesIn(name: string, text: string): string[] {
  return parseSync(name, text)
    .comments.filter(comment => SWITCH.test(comment.value) || (comment.type === 'Block' && BLOCK.test(comment.value)))
    .map(comment => {
      const line = text.slice(0, comment.start).split('\n').length
      const word = comment.value.trim().split(/\s/u)[0] ?? ''
      return `${name}:${line}: \`${word}\` is a linter directive: rules change in oxlint.config.ts, with their reason, never by a comment in the code`
    })
}
