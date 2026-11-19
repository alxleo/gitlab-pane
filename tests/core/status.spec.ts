import { expect, test } from 'vitest'
import fc from 'fast-check'

import { CI_STATUSES } from '../../hooks/gitlab-status.ts'
import { TONE_COLOURS, toneStyle } from '../../hooks/status.ts'
import { stripModel } from '../../hooks/strip-model.ts'
import type { CiStatus } from '../../types'

test('a picture carries the light shade of each tone it draws, and the dark one for while the app is dark', () => {
  expect(toneStyle(['error'])).toBe(`<style>.t-error{color:${TONE_COLOURS.error.light}}@media(prefers-color-scheme:dark){.t-error{color:${TONE_COLOURS.error.dark}}}</style>`)
})

test('a picture names each of its tones once, in one order, so two equal pictures are the same text', () => {
  expect(toneStyle(['warning', 'success', 'warning'])).toBe(toneStyle(['success', 'warning']))
  expect(toneStyle(['success', 'warning'])).toBe(
    `<style>.t-success{color:${TONE_COLOURS.success.light}}.t-warning{color:${TONE_COLOURS.warning.light}}@media(prefers-color-scheme:dark){.t-success{color:${TONE_COLOURS.success.dark}}.t-warning{color:${TONE_COLOURS.warning.dark}}}</style>`
  )
})

test('a picture in no tone carries no style', () => {
  expect(toneStyle([])).toBe('')
})

test('every tone a stage strip draws in has its shades in the strip, and no tone it does not draw', () => {
  const statuses = Object.keys(CI_STATUSES).filter((status): status is CiStatus => status in CI_STATUSES)
  const stage = fc.record({ name: fc.constantFrom('build', 'test', 'deploy'), status: fc.constantFrom(...statuses) })
  fc.assert(
    fc.property(fc.array(stage, { minLength: 1, maxLength: 12 }), stages => {
      const { source } = stripModel(
        stages.map(each => ({ ...each, jobs: [], ran: { done: [], running: [] } })),
        0
      )
      const drawn = new Set([...source.matchAll(/class='(t-\w+)'/gu)].map(found => found[1]))
      const shaded = new Set([...source.matchAll(/\.(t-\w+)\{color:/gu)].map(found => found[1]))
      expect(shaded).toEqual(drawn)
    })
  )
})
