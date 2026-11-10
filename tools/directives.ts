// No comment that changes what a linter does: a rule is switched or tuned in oxlint.config.ts, with its reason beside it, and
// never by a comment next to the code, where nobody reviews the rule. tools/check_files.ts runs this over every script the
// repository holds. It is not a lint rule because oxlint obeys `/* oxlint-disable */` even when the rule it silences is the
// one that refuses such comments. TypeScript's `@ts-…` comments are refused by the lint rule `typescript/ban-ts-comment`.
import { parseSync } from 'oxc-parser'

/** The files a directive could steer: JavaScript and TypeScript, modules and scripts. */
export const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/

// oxlint's and ESLint's own: `oxlint-disable…`, `eslint-disable…`, `eslint-enable`, `eslint-env`, `/* eslint rule: … */`.
const LINTER = /^\s*(?:eslint|oxlint)(?:-[a-z-]+)?(?:\s|$)/
// ESLint's declarations, which it reads from block comments only: `/* global a */`, `/* globals a */`, `/* exported a */`.
const DECLARATION = /^\s*(?:globals?|exported)(?:\s|$)/

/** Each linter directive among the comments of a script, as `file:line: what`. Strings and code are not comments. */
export function directivesIn(name: string, text: string): string[] {
  return parseSync(name, text)
    .comments.filter(comment => LINTER.test(comment.value) || (comment.type === 'Block' && DECLARATION.test(comment.value)))
    .map(comment => {
      const line = text.slice(0, comment.start).split('\n').length
      const word = comment.value.trim().split(/\s/)[0] ?? ''
      return `${name}:${line}: \`${word}\` is a linter directive: rules change in oxlint.config.ts, with their reason, never by a comment in the code`
    })
}
