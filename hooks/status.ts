import { raw, svg } from './svg.ts'
import type { RawSvg, SvgSource } from './svg.ts'

import type { CiStatus } from '../types'

/** Ends a switch over a union, so a new member is a compile error at every switch that does not name it. */
function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`)
}

/** A pipeline in one of these waits for nothing but a person. */
export function isSettled(status: CiStatus): boolean {
  switch (status) {
    case 'success':
    case 'failed':
    case 'canceled':
    case 'skipped':
    case 'manual':
      return true
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'waiting_for_callback':
    case 'pending':
    case 'running':
    case 'canceling':
    case 'scheduled':
    case 'unknown':
      return false
    default:
      return assertNever(status)
  }
}

export type Tone = 'success' | 'error' | 'warning' | 'subtle' | 'suggestion'

export type Glyph = '✓' | '✗' | '⏸' | '⊘' | '○' | '?' | '●'

export function statusMark(status: CiStatus | undefined): { glyph: Glyph; tone: Tone } {
  switch (status) {
    case 'success':
      return { glyph: '✓', tone: 'success' }
    case 'failed':
      return { glyph: '✗', tone: 'error' }
    case 'manual':
      return { glyph: '⏸', tone: 'warning' }
    case 'canceled':
    case 'skipped':
      return { glyph: '⊘', tone: 'subtle' }
    case undefined:
      return { glyph: '○', tone: 'subtle' }
    case 'unknown':
      return { glyph: '?', tone: 'subtle' }
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'waiting_for_callback':
    case 'pending':
    case 'running':
    case 'canceling':
    case 'scheduled':
      return { glyph: '●', tone: 'suggestion' }
    default:
      return assertNever(status)
  }
}

/**
 * Each tone as the desktop app paints its theme key, in its light theme and its dark one. Text and borders name the key
 * and the app picks the shade; a picture (a face, the stage strip) cannot name a key, so it carries both shades
 * (`toneStyle`), and the app's theme picks between them as it switches.
 */
export const TONE_COLOURS: Record<Tone, { light: string; dark: string }> = {
  success: { light: '#2c7a39', dark: '#4eba65' },
  error: { light: '#ab2b3f', dark: '#ff6b80' },
  warning: { light: '#966c1e', dark: '#ffc107' },
  suggestion: { light: '#3d5fe0', dark: '#b1b9f9' },
  subtle: { light: '#8a8983', dark: '#6f6e69' },
}

const TONES = Object.keys(TONE_COLOURS).filter((tone): tone is Tone => tone in TONE_COLOURS)

/** The class a picture's part takes to be drawn in a tone: its `fill` or `stroke` is `currentColor`. */
export const toneClass = (tone: Tone): string => `t-${tone}`

/**
 * The style a picture carries so each of `tones` is drawn in the app theme's shade: the light one, and the dark one while
 * the app is dark. Only the tones named, each once, in one order, so equal pictures stay equal.
 */
export function toneStyle(tones: readonly Tone[]): SvgSource {
  const used = TONES.filter(tone => tones.includes(tone))
  const rules = (shade: 'light' | 'dark'): RawSvg => raw(used.map(tone => svg`.${toneClass(tone)}{color:${TONE_COLOURS[tone][shade]}}`))
  return used.length === 0 ? svg`` : svg`<style>${rules('light')}@media(prefers-color-scheme:dark){${rules('dark')}}</style>`
}

export function stageTone(status: CiStatus): Tone {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'error'
    case 'manual':
      return 'warning'
    case 'canceled':
    case 'skipped':
    case 'created':
    case 'unknown':
      return 'subtle'
    case 'waiting_for_resource':
    case 'preparing':
    case 'waiting_for_callback':
    case 'pending':
    case 'running':
    case 'canceling':
    case 'scheduled':
      return 'suggestion'
    default:
      return assertNever(status)
  }
}
