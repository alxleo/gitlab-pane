// Cutting text that is read: where a person sees one character (a flag, a skin-toned hand, a letter with its accent), a cut
// never lands inside it, and a character is no longer free to be as long as its marks make it: one letter can carry any
// number of combining marks, so every cut is bounded in UTF-16 units too, which is what `.length` and every budget here
// count. Pure; the same wherever it runs. The text is read only as far as the cut goes, so a megabyte description costs
// what its first screen does.

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** How many UTF-16 units the code point at `at` takes. */
const widthAt = (text: string, at: number): number => ((text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1)

/** The start of `text` of at most `size` UTF-16 units, ended before a code point that would not fit whole. */
function firstUnits(text: string, size: number): string {
  let end = 0
  while (end < text.length && end + widthAt(text, end) <= size) {
    end += widthAt(text, end)
  }
  return text.slice(0, end)
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
 */
export const shorten = (text: string, room: number): string => (cut(text, room, room) === text ? text : `${cut(text, room - 1, room - 1)}…`)

/**
 * The first `count` characters of `text` as a person counts them, each cut to its first `size` units: for a few letters
 * of a name, where a character longer than `size` is a letter with more marks than a name has, and its first code points
 * are the letter.
 */
export function leading(text: string, count: number, size: number): string[] {
  const found: string[] = []
  if (count <= 0) {
    return found
  }
  for (const { segment } of SEGMENTER.segment(text)) {
    found.push(firstUnits(segment, size))
    if (found.length === count) {
      break
    }
  }
  return found
}
