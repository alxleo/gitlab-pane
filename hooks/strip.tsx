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
  // Where no description shows (VS Code, a phone), the picture carries its stages as its own title instead.
  return kit.showsHints ? (
    <Svg width={model.width} height={10} alt={model.alt} source={model.source} />
  ) : (
    <Svg isInteractive width={model.width} height={10} alt={model.alt} source={model.titled} />
  )
}
