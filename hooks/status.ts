import { raw, svg } from './svg'
import type { RawSvg } from './svg'

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

/** A colour in the app's light theme and its dark one. */
export type Shades = { light: string; dark: string }

/**
 * Each tone as the pictures paint it (a face's badge, the stage strip), in the app's light theme and its dark one; text
 * names the theme key and the app paints it. A picture cannot name a key, so it carries both shades (`tonePaint`) and the
 * app's theme picks one as it switches. Dark: the app's own dark key shades, sampled from the desktop app. Light: the
 * vivid fill shades, since the app's light keys are dark text shades that turn muddy on a small mark beside an avatar;
 * each meets 3:1 on white, and those under a white glyph 4.5:1.
 */
export const TONE_COLOURS: Record<Tone, Shades> = {
  success: { light: '#1f883d', dark: '#53c656' },
  error: { light: '#cf222e', dark: '#fa8181' },
  warning: { light: '#bf8700', dark: '#e59c08' },
  suggestion: { light: '#0969da', dark: '#6aacf1' },
  subtle: { light: '#6e7781', dark: '#9c9c9c' },
}

/** The pane's background in either theme, sampled from the desktop app: a badge's edge in it cuts the badge out of the avatar. */
export const PAGE: Shades = { light: '#ffffff', dark: '#191919' }

/**
 * Wraps a picture's parts so those painted by `tonePaint` follow the app's theme: they take the light or dark scheme the
 * app prefers, where a picture would otherwise stay light. A group, not the root `<svg>`: a root with a dark scheme paints
 * an opaque dark canvas behind the picture where it is drawn in a frame (the stage strip), and the root stays transparent.
 */
export const followingTheme = (parts: RawSvg): RawSvg => raw(svg`<g style='color-scheme:light dark'>${parts}</g>`)

/**
 * Paints a picture's part (its `fill`, its `stroke`, or both) in the light shade or the dark one as the app's theme is:
 * each attribute holds the light shade, for a surface that knows no `light-dark()`, and one style holds both, since an
 * element with two `style` attributes is not drawn at all. About 60 characters a paint.
 */
export const themePaint = (paints: readonly (readonly ['fill' | 'stroke', Shades])[]): RawSvg => {
  const attributes = paints.map(([paint, { light }]) => svg`${paint}='${light}' `)
  const style = paints.map(([paint, { light, dark }]) => `${paint}:light-dark(${light},${dark})`).join(';')
  return raw(svg`${raw(attributes)}style='${style}'`)
}

/** Paints a picture's part in a tone (`themePaint`). */
export const tonePaint = (paint: 'fill' | 'stroke', tone: Tone): RawSvg => themePaint([[paint, TONE_COLOURS[tone]]])

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
