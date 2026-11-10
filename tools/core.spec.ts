import { describe, expect, it } from 'vitest'

import { coreFiles, includeOf } from './core.ts'

describe('the core list', () => {
  it("is tsconfig.core.json's include, and holds the core's own files", () => {
    expect(coreFiles()).toContain('hooks/decode.ts')
    expect(coreFiles()).not.toContain('types/index.d.ts')
  })

  it('a tsconfig without an include list stops the check rather than leaving the core empty', () => {
    expect(() => includeOf({ files: ['hooks/decode.ts'] })).toThrow('tsconfig.core.json has no "include" list of paths')
  })

  it('an include list with something other than paths in it stops the check', () => {
    expect(() => includeOf({ include: ['hooks/decode.ts', 7] })).toThrow('tsconfig.core.json has no "include" list of paths')
  })

  it('an empty include list stops the check, since a core of nothing checks nothing', () => {
    expect(() => includeOf({ include: [] })).toThrow('tsconfig.core.json has no "include" list of paths')
  })
})
