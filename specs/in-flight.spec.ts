import { expect, test } from 'vitest'

import { isLastTyped, serialised, typed } from '../hooks/in-flight'

test('a pause in typing acts only on the last change typed into its box, whatever another box was typed into since', () => {
  const first = typed('box-a')
  const other = typed('box-b')
  expect(isLastTyped('box-a', first)).toBe(true)
  const second = typed('box-a')
  expect(isLastTyped('box-a', first)).toBe(false)
  expect(isLastTyped('box-a', second)).toBe(true)
  expect(isLastTyped('box-b', other)).toBe(true)
})

test('a read that fails does not stop the one queued behind it', async () => {
  const order: string[] = []
  const first = serialised('reads', () => Promise.reject(new Error('down')))
  const second = serialised('reads', async () => {
    order.push('second')
  })
  const third = serialised('reads', async () => {
    order.push('third')
  })
  await expect(first).rejects.toThrow('down')
  await Promise.all([second, third])
  expect(order).toEqual(['second'])
  expect(second).toBe(third)
})
