import { expect, test } from 'vitest'
import fc from 'fast-check'

import { CI_STATUSES } from '../../hooks/gitlab-status.ts'
import { PAGE, TONE_COLOURS, followingTheme, stageTone, themePaint, tonePaint } from '../../hooks/status.ts'
import { stripModel } from '../../hooks/strip-model.ts'
import { raw, svg } from '../../hooks/svg.ts'
import type { CiStatus } from '../../types'

test("a picture's part is painted in its tone's light shade, and its dark one while the app is dark", () => {
  const { light, dark } = TONE_COLOURS.error
  expect(svg`<circle ${tonePaint('stroke', 'error')}/>`).toBe(`<circle stroke='${light}' style='stroke:light-dark(${light},${dark})'/>`)
  // A fill and a stroke share one style: an element with two style attributes is not drawn at all.
  expect(
    svg`<circle ${themePaint([
      ['fill', TONE_COLOURS.error],
      ['stroke', PAGE],
    ])}/>`
  ).toBe(`<circle fill='${light}' stroke='${PAGE.light}' style='fill:light-dark(${light},${dark});stroke:light-dark(${PAGE.light},${PAGE.dark})'/>`)
  // On a group, so the picture's root stays transparent where it is drawn in a frame.
  expect(svg`<svg>${followingTheme(raw(svg`<circle/>`))}</svg>`).toBe(`<svg><g style='color-scheme:light dark'><circle/></g></svg>`)
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
      // Every painted part is inside the group that follows the theme, and the root takes no scheme.
      const [, themed = ''] = /<g style='color-scheme:light dark'>(.*)<\/g><\/svg>$/u.exec(source) ?? []
      expect(source.replace(themed, '')).not.toContain('light-dark(')
      expect(source).toMatch(/^<svg [^>]*height='10'>/u)
      for (const { status } of stages) {
        const { light, dark } = TONE_COLOURS[stageTone(status)]
        expect(source).toContain(`fill='${light}' style='fill:light-dark(${light},${dark})'`)
      }
      // No part is painted one shade alone, which would stay put as the theme switches.
      expect(source.match(/fill='#/gu)?.length ?? 0).toBe(source.match(/light-dark\(/gu)?.length ?? 0)
    })
  )
})
