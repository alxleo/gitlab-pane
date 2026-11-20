import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { PAGE } from '../hooks/status.ts'

const CSS = readFileSync(join(import.meta.dirname, 'screens', 'pane.css'), 'utf8')

/**
 * What the desktop app paints its theme keys in, for text, sampled from shots of the app in light and in dark. The pane's
 * pictures carry their own shades (`TONE_COLOURS`); the words beside them are these.
 */
const APP_KEYS: Record<string, { light: string; dark: string }> = {
  success: { light: '#016d11', dark: '#53c656' },
  error: { light: '#a42628', dark: '#fa8181' },
  warning: { light: '#895903', dark: '#e59c08' },
  suggestion: { light: '#1757ac', dark: '#6aacf1' },
  subtle: { light: '#666666', dark: '#9c9c9c' },
}

/** The `--<name>` values a block of pane.css sets, by name. */
const valuesIn = (block: string): Record<string, string> => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gu)].map(([, name = '', hex = '']) => [name, hex]))

const [light = '', dark = ''] = CSS.split('@media (prefers-color-scheme: dark)')

test('the pictures paint each theme key as the desktop app paints it, in the light theme and the dark one', () => {
  for (const [tone, shades] of Object.entries(APP_KEYS)) {
    expect(valuesIn(light)[`c-${tone}`], `${tone} in light`).toBe(shades.light)
    expect(valuesIn(dark)[`c-${tone}`], `${tone} in dark`).toBe(shades.dark)
  }
})

test("the pane's background is the one a face's badge is cut out with, so no badge shows a ring", () => {
  expect(valuesIn(light)['surface']).toBe(PAGE.light)
  expect(valuesIn(dark)['surface']).toBe(PAGE.dark)
})
