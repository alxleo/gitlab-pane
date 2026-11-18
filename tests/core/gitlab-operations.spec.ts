import { expect, test } from 'vitest'
import { Kind, parse } from 'graphql'

import { mergeWrite } from '../../hooks/ask-merge.ts'
import { moveStateQuery } from '../../hooks/ask-move-state.ts'
import { COMPLEXITY, DOCUMENTS, isWrite } from '../../hooks/gitlab-operations.ts'
import type { Operations } from '../../hooks/gitlab-operations.ts'

const isOperation = (name: string): name is keyof Operations => Object.hasOwn(DOCUMENTS, name)

/** The kind of the one operation a document holds: query or mutation. */
const kindOf = (text: string): string => {
  const operation = parse(text).definitions.find(definition => definition.kind === Kind.OPERATION_DEFINITION)
  return operation?.kind === Kind.OPERATION_DEFINITION ? operation.operation : 'none'
}

test('a document that changes GitLab is a mutation and is sent once; every other is a query, which may be tried again', () => {
  for (const [name, text] of Object.entries(DOCUMENTS)) {
    expect(isOperation(name)).toBe(true)
    const operation = isOperation(name) ? name : 'Authored'
    expect([name, kindOf(text)]).toEqual([name, isWrite({ operation }) ? 'mutation' : 'query'])
  }
  expect(isWrite(mergeWrite('g/p', 1, 'abc', null, false))).toBe(true)
  expect(isWrite(moveStateQuery('g/p', 1))).toBe(false)
})

test('no write is scored: scoring a document sends it to gitlab.com', () => {
  expect(Object.keys(COMPLEXITY).filter(name => isOperation(name) && isWrite({ operation: name }))).toEqual([])
})

test('every document holds its operation and exactly the fragments it uses, each once, as GitLab requires', () => {
  for (const [name, text] of Object.entries(DOCUMENTS)) {
    const definitions = parse(text).definitions
    const fragments = definitions.flatMap(definition => (definition.kind === Kind.FRAGMENT_DEFINITION ? [definition.name.value] : []))
    const spread = new Set([...text.matchAll(/\.\.\.([A-Z]\w*)/gu)].map(([, used = '']) => used))
    expect([name, definitions.filter(definition => definition.kind === Kind.OPERATION_DEFINITION).length]).toEqual([name, 1])
    expect([name, fragments.toSorted()]).toEqual([name, [...spread].toSorted()])
  }
})
