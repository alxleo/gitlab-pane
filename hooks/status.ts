import type { CiStatus } from '../types'

/** Ends a switch over a union, so a new member is a compile error at every switch that does not name it. */
export function assertNever(value: never): never {
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

export const STAGE_COLOURS: Record<Tone, string> = {
  success: '#2da44e',
  error: '#cf222e',
  warning: '#bf8700',
  suggestion: '#0969da',
  subtle: '#8c959f',
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
