import { expect, test } from 'vitest'

import { documentOf } from '../../hooks/gitlab-document.ts'

const fragment = (name: string, body: string): string => `\n  fragment ${name} on Thing {\n    ${body}\n  }\n`

const A = fragment('A', 'id ...C')
const B = fragment('B', 'name')
const C = fragment('C', 'size')
const UNUSED = fragment('Unused', 'id')

test('a document carries the fragments it spreads and those they spread, once each, in the order its family lists them', () => {
  const operation = 'query Q { thing { ...A ...B ...A } }'
  expect(documentOf(operation, [B, UNUSED, C, A])).toBe(operation + B + C + A)
})

test('a document that spreads no fragment is its operation alone, and an inline fragment is no spread', () => {
  const operation = 'query Q { thing { ... on Other { id } } }'
  expect(documentOf(operation, [A, B, C])).toBe(operation)
})

test('a spread its family has no fragment for throws, as GitLab would refuse the document', () => {
  expect(() => documentOf('query Q { thing { ...Missing } }', [A, C])).toThrow('Missing')
  expect(() => documentOf('query Q { thing { ...A } }', [A])).toThrow('C')
})

test('a family entry that is no fragment throws', () => {
  expect(() => documentOf('query Q { id }', ['query Other { id }'])).toThrow('not a fragment')
})
