import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { TONE_COLOURS } from '../hooks/status.ts'

const CSS = readFileSync(join(import.meta.dirname, 'screens', 'pane.css'), 'utf8')

/** The `--c-<tone>` values a block of pane.css sets, by tone. */
const tonesIn = (block: string): Record<string, string> => Object.fromEntries([...block.matchAll(/--c-(\w+):\s*(#[0-9a-f]{6});/gu)].map(([, tone = '', hex = '']) => [tone, hex]))

const [light = '', dark = ''] = CSS.split('@media (prefers-color-scheme: dark)')

test("the pictures paint each tone as the pane's pictures do, in the light theme and the dark one", () => {
  for (const [tone, { light: lightShade, dark: darkShade }] of Object.entries(TONE_COLOURS)) {
    expect(tonesIn(light)[tone], `${tone} in light`).toBe(lightShade)
    expect(tonesIn(dark)[tone], `${tone} in dark`).toBe(darkShade)
  }
})
