// Cutting text that is read: where a person sees one character (a flag, a skin-toned hand, a letter with its accent), a cut
// never lands inside it, and a character is no longer free to be as long as its marks make it: one letter can carry any
// number of combining marks, so every cut is bounded in UTF-16 units too, which is what `.length` and every budget here
// count. Pure; the same wherever it runs. The text is read only as far as the cut goes, so a megabyte description costs
// what its first screen does.

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** A combining mark: what a letter carries and adds to it, a code point that is no character of its own. */
const MARK = /\p{M}/u

/**
 * The start of one character, `whole`, that is longer than `size` UTF-16 units: its first code point if that fits, and the
 * combining marks that directly follow it while they fit. It stops at the first code point that is no mark or would not fit,
 * so a joiner, a skin tone or a tag never follows the first code point, and what is left is the letter and its accents, never
 * a joined sequence cut where it waits for its next part.
 */
function withMarks(whole: string, size: number): string {
  let end = 0
  for (const point of whole) {
    if (end + point.length > size || (end > 0 && !MARK.test(point))) {
      break
    }
    end += point.length
  }
  return whole.slice(0, end)
}

/**
 * The longest start of `text` made of whole characters as a person counts them, with at most `count` of them and at most
 * `ceiling` UTF-16 units. A character that would pass either is left out whole, never halved, and the cut ends there.
 */
export function cut(text: string, count: number, ceiling: number): string {
  if (count <= 0) {
    return ''
  }
  let end = 0
  let taken = 0
  for (const { segment } of SEGMENTER.segment(text)) {
    if (end + segment.length > ceiling) {
      break
    }
    end += segment.length
    taken += 1
    if (taken === count) {
      break
    }
  }
  return text.slice(0, end)
}

/**
 * `text` if it fits `room` characters and `room` units, else its start that fits one fewer, and an ellipsis: the result is
 * never more than `room` units, whatever the text is made of.
 *
 * A text of at most `room` units is returned as it is, without being read: a character is never shorter than one unit, so
 * such a text has at most `room` characters as well, and `cut` would take every one of them, which is the text itself. The
 * test is exact, not an approximation, and a text longer than `room` units takes the slow path below.
 */
export function shorten(text: string, room: number): string {
  if (text.length <= room) {
    return text
  }
  return cut(text, room, room) === text ? text : `${cut(text, room - 1, room - 1)}…`
}

/**
 * The first `count` characters of `text` as a person counts them, each kept whole when it is within `size` UTF-16 units and
 * otherwise cut to its first code point and the combining marks after it that fit: for a few letters of a name, where a
 * character longer than `size` is a letter with more marks than a name has, or a joined emoji, and its first code point is
 * the letter. A joiner and a tag are no marks, so no such cut ends in one, unless the character itself begins with it.
 */
export function leading(text: string, count: number, size: number): string[] {
  const found: string[] = []
  if (count <= 0) {
    return found
  }
  for (const { segment } of SEGMENTER.segment(text)) {
    found.push(segment.length <= size ? segment : withMarks(segment, size))
    if (found.length === count) {
      break
    }
  }
  return found
}
