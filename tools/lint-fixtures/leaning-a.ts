// With leaning-b.ts, two modules outside the core that import each other, one of them a package: together they lean.
import { isRecord } from '../../hooks/decode.ts'
import { readsAsYaml } from './leaning-b.ts'

export const isYamlRecord = (text: string): boolean => readsAsYaml(text) && isRecord(text)
