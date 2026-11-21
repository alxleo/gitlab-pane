// A pipeline's stage strip as plain data. One image per row. Passed stages are drawn as runs of a repeating square; any
// other stage is its own square. What each stage is (its name, state and time) is the strip's description, a line a stage,
// with the passed ones counted in one, shown once the pointer rests on it. A surface without Svg gets a glyph per stage, from
// `tones`. Pure; the draw layer only puts the source in an Svg.
import { duration, plural, ranFor } from './format.ts'
import { followingTheme, stageTone, STATUS_WORD, tonePaint } from './status.ts'
import type { Tone } from './status.ts'
import { raw, svg } from './svg.ts'
import type { SvgSource } from './svg.ts'

import type { Stage } from '../types'

export type StripModel = {
  /** One tone per stage, for a surface that draws a glyph for each. */
  tones: Tone[]
  width: number
  alt: string
  /** The description, a line each: how many stages passed, then every other stage as `stageLine` says it, in order. */
  hint: string[]
  source: SvgSource
  /** The same picture with the description as its title, for a surface that shows no description of its own. */
  titled: SvgSource
}

/** `build · passed · ran 3m`; a stage none of whose jobs ran says only its state. */
function stageLine(stage: Stage, now: number): string {
  const ran = ranFor([stage], now)
  const timing = ran === 0 ? '' : stage.status === 'running' ? ` · running ${duration(ran)}` : ` · ran ${duration(ran)}`
  return `${stage.name} · ${STATUS_WORD[stage.status]}${timing}`
}

const passed = (stage: Stage | undefined): boolean => stage?.status === 'success'

export function stripModel(stages: Stage[], now: number): StripModel {
  const marks = stages.map((stage, i) => {
    if (!passed(stage)) {
      return svg`<use href='#s' x='${i * 12}' ${tonePaint('fill', stageTone(stage.status))}/>`
    }
    if (passed(stages[i - 1])) {
      return svg``
    }
    const run = stages.slice(i).findIndex(next => !passed(next))
    return svg`<rect x='${i * 12}' width='${(run === -1 ? stages.length - i : run) * 12}' height='10' fill='url(#p)'/>`
  })
  const count = stages.filter(passed).length
  const width = stages.length * 12
  const hint = [...(count > 0 ? [`${plural(count, 'stage')} passed`] : []), ...stages.filter(stage => !passed(stage)).map(stage => stageLine(stage, now))]
  // Passed runs fill with the pattern, so it is there only when a stage passed.
  const drawing = followingTheme(
    raw([
      svg`<defs><rect id='s' width='10' height='10' rx='2'/>${raw(count > 0 ? svg`<pattern id='p' width='12' height='10' patternUnits='userSpaceOnUse'><use href='#s' ${tonePaint('fill', 'success')}/></pattern>` : svg``)}</defs>`,
      ...marks,
    ])
  )
  return {
    tones: stages.map(stage => stageTone(stage.status)),
    width,
    alt: `${stages.length} stages`,
    hint,
    source: svg`<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='10'>${drawing}</svg>`,
    titled: svg`<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='10'><title>${hint.join('\n')}</title>${drawing}</svg>`,
  }
}
