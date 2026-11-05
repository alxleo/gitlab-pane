import { expect, test } from 'vitest'
import fc from 'fast-check'

import { raw, svg } from '../../hooks/svg.ts'
import { textArb } from './arbitrary.ts'

test('svg escapes every value, in text and in either kind of quote, and leaves a raw fragment alone', async () => {
  const hostile = `</title><b>' onload='1" a="2&`
  const escaped = '&lt;/title&gt;&lt;b&gt;&apos; onload=&apos;1&quot; a=&quot;2&amp;'
  expect(svg`<title>${hostile}</title>`).toBe(`<title>${escaped}</title>`)
  expect(svg`<a b='${hostile}' c="${hostile}"/>`).toBe(`<a b='${escaped}' c="${escaped}"/>`)
  expect(svg`<g x='${12.5}'>${raw(svg`<i/>`)}${raw([svg`<b/>`, svg`<u/>`])}</g>`).toBe("<g x='12.5'><i/><b/><u/></g>")
  expect(svg`<g>${svg`<i/>`}</g>`).toBe('<g>&lt;i/&gt;</g>')
})

test("no string put into an svg template makes markup: the only < > quotes left are the template's own", () => {
  fc.assert(
    fc.property(textArb, textArb, fc.double(), (inText, inAttribute, number) => {
      const out: string = svg`<t a='${inAttribute}' b="${inAttribute}" n='${number}'>${inText}</t>`
      expect([...out].filter(char => char === '<')).toHaveLength(2)
      expect([...out].filter(char => char === '>')).toHaveLength(2)
      expect([...out].filter(char => char === "'")).toHaveLength(4)
      expect([...out].filter(char => char === '"')).toHaveLength(2)
      expect(out.replace(/&(?:amp|lt|gt|quot|apos);/g, '')).not.toContain('&')
    })
  )
})
