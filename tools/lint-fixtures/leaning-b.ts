// The other half of leaning-a.ts's cycle, the one that imports a package.
import { parse } from 'yaml'

import { isYamlRecord } from './leaning-a.ts'

export const readsAsYaml = (text: string): boolean => parse(text) !== undefined || isYamlRecord('')
