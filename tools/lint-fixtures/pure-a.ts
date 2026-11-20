// With pure-b.ts, two modules outside the core that import each other and only core files: together they are pure.
import { isRecord } from '../../hooks/decode.ts'
import { isEmpty } from './pure-b.ts'

export const isFilled = (value: unknown): boolean => isRecord(value) && !isEmpty(value)
