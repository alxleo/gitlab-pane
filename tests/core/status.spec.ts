import { expect, test } from 'vitest'
import fc from 'fast-check'

import { CI_STATUSES } from '../../hooks/gitlab-status.ts'
import { FOLLOWS_THEME, TONE_COLOURS, stageTone, tonePaint } from '../../hooks/status.ts'
import { stripModel } from '../../hooks/strip-model.ts'
import { svg } from '../../hooks/svg.ts'
import type { CiStatus } from '../../types'

test("a picture's part is painted in its tone's light shade, and its dark one while the app is dark", () => {
  const { light, dark } = TONE_COLOURS.error
  expect(svg`<circle ${tonePaint('stroke', 'error')}/>`).toBe(`<circle stroke='${light}' style='stroke:light-dark(${light},${dark})'/>`)
  expect(svg`<svg ${FOLLOWS_THEME}>`).toBe(`<svg style='color-scheme:light dark'>`)
})

test('a stage strip follows the theme, and paints each stage in its tone in both shades', () => {
  const statuses = Object.keys(CI_STATUSES).filter((status): status is CiStatus => status in CI_STATUSES)
  const stage = fc.record({ name: fc.constantFrom('build', 'test', 'deploy'), status: fc.constantFrom(...statuses) })
  fc.assert(
    fc.property(fc.array(stage, { minLength: 1, maxLength: 12 }), stages => {
      const { source } = stripModel(
        stages.map(each => ({ ...each, jobs: [], ran: { done: [], running: [] } })),
        0
      )
      expect(source).toContain(svg`${FOLLOWS_THEME}`)
      for (const { status } of stages) {
        const { light, dark } = TONE_COLOURS[stageTone(status)]
        expect(source).toContain(`fill='${light}' style='fill:light-dark(${light},${dark})'`)
      }
      // No part is painted one shade alone, which would stay put as the theme switches.
      expect(source.match(/fill='#/gu)?.length ?? 0).toBe(source.match(/light-dark\(/gu)?.length ?? 0)
    })
  )
})
