import { describe, expect, it } from 'vitest'

import { directivesIn } from './directives.ts'

// Each directive below sits in a string here, which is not a comment, so this file passes its own check.
describe('linter directives in comments', () => {
  it('a blanket oxlint-disable at the top of a file is refused, though oxlint would obey it over every rule', () => {
    expect(directivesIn('hooks/a.ts', '/* oxlint-disable */\nexport const a: any = 1\n')).toEqual([
      'hooks/a.ts:1: `oxlint-disable` is a linter directive: rules change in oxlint.config.ts, with their reason, never by a comment in the code',
    ])
  })

  it('a directive that names one rule, on its line or the next, is refused', () => {
    const text = ['// oxlint-disable-next-line typescript/no-explicit-any', 'export const a: any = 1 // oxlint-disable-line', ''].join('\n')
    expect(directivesIn('hooks/a.ts', text).map(found => found.split(':').slice(0, 2).join(':'))).toEqual(['hooks/a.ts:1', 'hooks/a.ts:2'])
  })

  it("ESLint's directives are refused as well as oxlint's", () => {
    const text = ['/* eslint-disable */', '// eslint-disable-next-line no-console', '/* eslint no-console: off */', '/* eslint-env node */', ''].join('\n')
    expect(directivesIn('tools/a.ts', text)).toHaveLength(4)
  })

  it("ESLint's global and exported declarations are refused in block comments", () => {
    expect(directivesIn('tools/a.cjs', '/* global window */\n/* globals a, b */\n/* exported c */\n')).toHaveLength(3)
  })

  it('prose that starts with "global" in a line comment is not a directive', () => {
    expect(directivesIn('hooks/a.ts', '// global state lives in atoms, never in a module\nexport {}\n')).toEqual([])
  })

  it('a directive written in a string is not a comment and passes', () => {
    expect(directivesIn('hooks/a.ts', "export const a = '/* oxlint-disable */'\nexport const b = `// eslint-disable-line`\n")).toEqual([])
  })

  it('a directive inside JSX braces is a comment like any other', () => {
    expect(directivesIn('hooks/a.tsx', 'export const a = <b>{/* oxlint-disable-line */}</b>\n')).toHaveLength(1)
  })
})
