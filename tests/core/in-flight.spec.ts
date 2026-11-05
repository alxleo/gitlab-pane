import { expect, test } from 'vitest'

import { serialised } from '../../hooks/in-flight.ts'

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
