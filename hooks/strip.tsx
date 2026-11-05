import { duration, plural, ranFor } from './format'
import type { Kit } from './kit'
import { STAGE_COLOURS, stageTone } from './status'
import { raw, svg } from './svg'

import type { CiStatus, Stage } from '../types'

export const STATUS_WORD: Record<CiStatus, string> = {
  success: 'passed',
  failed: 'failed',
  running: 'running',
  pending: 'queued',
  created: 'not started',
  manual: 'waiting on a manual job',
  scheduled: 'scheduled',
  skipped: 'skipped',
  canceled: 'canceled',
  canceling: 'canceling',
  preparing: 'preparing',
  waiting_for_resource: 'waiting for a resource',
  waiting_for_callback: 'waiting for a callback',
  unknown: 'in a state this pane does not know',
}

/** `build · passed · ran 3m`; a stage none of whose jobs ran says only its state. */
function stageLine(kit: Kit, stage: Stage): string {
  const ran = ranFor([stage], kit.now)
  const timing = ran === 0 ? '' : stage.status === 'running' ? ` · running ${duration(ran)}` : ` · ran ${duration(ran)}`
  return `${stage.name} · ${STATUS_WORD[stage.status]}${timing}`
}

const passed = (stage: Stage | undefined): boolean => stage?.status === 'success'

// One image per row. Passed stages are drawn as runs of a repeating square and counted in the image's tooltip; any
// other stage is its own square with its name, state and time. A surface without Svg gets a glyph per stage.
export function strip(kit: Kit, stages: Stage[]) {
  const { Box, Text, Svg } = kit
  if (Svg === undefined) {
    return (
      <Box flexDirection="row" flexShrink={0}>
        {stages.map(stage => (
          <Text color={stageTone(stage.status)}>■</Text>
        ))}
      </Box>
    )
  }
  const marks = stages.map((stage, i) => {
    if (!passed(stage)) {
      return svg`<use href='#s' x='${i * 12}' fill='${STAGE_COLOURS[stageTone(stage.status)]}'><title>${stageLine(kit, stage)}</title></use>`
    }
    if (passed(stages[i - 1])) {
      return svg``
    }
    const run = stages.slice(i).findIndex(next => !passed(next))
    return svg`<rect x='${i * 12}' width='${(run === -1 ? stages.length - i : run) * 12}' height='10' fill='url(#p)'/>`
  })
  const count = stages.filter(passed).length
  const width = stages.length * 12
  return (
    <Svg
      isInteractive
      width={width}
      height={10}
      alt={`${stages.length} stages`}
      source={svg`<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='10'>${raw(count > 0 ? svg`<title>${plural(count, 'stage')} passed</title>` : svg``)}<defs><rect id='s' width='10' height='10' rx='2'/><pattern id='p' width='12' height='10' patternUnits='userSpaceOnUse'><use href='#s' fill='${STAGE_COLOURS.success}'/></pattern></defs>${raw(marks)}</svg>`}
    />
  )
}
