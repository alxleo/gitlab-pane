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
 * A person's initials on a disc coloured by their username, `size` pixels across from the origin: marks to sit inside
 * a larger drawing. `initials` are the letters drawn, such as ones taken from their name, as a handle like `ixm5302`
 * gives odd ones; the colour stays the username's, so a person keeps one colour everywhere.
 */
export function discMarks(username: string, size = 16, initials = initialsOf(username)): string {
  const middle = size / 2
  return (
    `<circle cx='${middle}' cy='${middle}' r='${middle}' fill='${FILLS[hashNumber(username) % FILLS.length]}'/>` +
    `<text x='${middle}' y='${middle * 1.33}' font-family='system-ui' font-size='${middle * 0.9}' font-weight='700' text-anchor='middle' fill='#fff'>${initials.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3)}</text>`
  )
}

/** The disc alone as Svg source, `size` pixels square: about 250 characters, far less than a picture. */
export function discSource(username: string, size = 16, initials = initialsOf(username)): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${discMarks(username, size, initials)}</svg>`
}
