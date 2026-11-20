// The other half of pure-a.ts's cycle.
import { isFilled } from './pure-a.ts'

export const isEmpty = (value: unknown): boolean => value === null || (Array.isArray(value) && !value.some(isFilled))
