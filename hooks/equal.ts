// Structural equality for the plain data the atoms hold, so a write of what is already there can be skipped: a subscriber
// is drawn again for every write, changed or not.

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether two values hold the same data: the same primitives, in arrays of the same order, objects of the same keys. */
export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => isEqual(item, b[i]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(key => key in b && isEqual(a[key], b[key]))
  }
  return false
}
