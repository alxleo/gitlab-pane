import type { Kit } from './kit'
import type { StripModel } from './strip-model'

/** The stage strip as the row model made it: one image per row, or a glyph per stage where the surface draws no Svg. */
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
  return <Svg isInteractive width={model.width} height={10} alt={model.alt} source={model.source} />
}
