import type { Kit } from './kit'
import type { PersonRow } from './pane-model'

/**
 * A person's face: their avatar or initials on a disc, ringed in the colour of where they stand, as the row model made
 * it; a coloured mark where the surface draws no Svg.
 */
export function face(kit: Kit, person: PersonRow, withPicture: boolean) {
  const { Svg, Text } = kit
  if (Svg === undefined) {
    return <Text color={person.tone}>{person.glyph}</Text>
  }
  return <Svg width={22} height={22} alt={person.alt} source={withPicture && person.picture !== null ? person.picture : person.plain} />
}
