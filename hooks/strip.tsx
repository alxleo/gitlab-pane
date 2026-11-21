import { hintChip } from './hint-chip'
import type { Kit } from './kit'
import type { StripModel } from './strip-model'

/** The stage strip as the row model made it: one picture a row, or a glyph a stage where the surface draws no Svg. */
export function strip(kit: Kit, model: StripModel) {
  const { Box, Text, Svg } = kit
  if (Svg === undefined) {
    return (
      <Box flexDirection="row" flexShrink={0}>
        {model.tones.map(tone => (
          <Text color={tone}>■</Text>
        ))}
      </Box>
    )
  }
  // Where no description shows (VS Code and a phone draw no title tooltip either), the picture's text names its stages, as
  // the description would, cleaned and cut the same way, for whatever reads it out.
  const said = kit.showsHints ? model.alt : (hintChip(model.hint)?.lines.join(', ') ?? model.alt)
  return <Svg width={model.width} height={10} alt={said} source={model.source} />
}
