/** Fills for initials discs, picked by name so a person keeps one colour wherever they appear. */
const FILLS = ['#5B8DEF', '#E5734A', '#3FA27B', '#B062D8', '#C9971C', '#E0567A', '#3A9FBF', '#7A8899']

const hashNumber = (text: string): number =>
  [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7)

/** `Tessa.Ravensworth` is TR; a handle with no separator gives its first two letters. */
export function initialsOf(username: string): string {
  const parts = username.split(/[._\-\s]+/).filter(Boolean)
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : username.slice(0, 2)
  return letters.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/**
 * A person's initials on a disc coloured by their username, as Svg source `size` pixels square; given `ring`, a
 * colour, the disc sits inside a ring of it, as a face with a picture does. `initials` are the letters drawn, such as
 * ones taken from their name, as a handle like `ixm5302` gives odd ones; the colour stays the username's, so a person
 * keeps one colour everywhere. About 330 characters: far less than a picture.
 */
export function discSource(username: string, size = 16, ring?: string, initials = initialsOf(username)): string {
  const middle = size / 2
  const radius = ring ? middle - 2 : middle
  const outline = ring ? `<circle cx='${middle}' cy='${middle}' r='${middle - 1}' fill='none' stroke='${ring}' stroke-width='1.5'/>` : ''
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<circle cx='${middle}' cy='${middle}' r='${radius}' fill='${FILLS[hashNumber(username) % FILLS.length]}'/>${outline}` +
    `<text x='${middle}' y='${middle + radius * 0.33}' font-family='-apple-system,Helvetica,sans-serif' font-size='${radius * 0.9}' font-weight='700' text-anchor='middle' fill='#fff'>${initials.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3)}</text></svg>`
  )
}
