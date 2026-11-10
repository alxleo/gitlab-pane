// What a person counts as one character, for text that is cut or measured to be read: a flag, a skin-toned hand and a letter
// with its accent are one each, though each is several code points and a cut between them leaves half of one. Pure; the same
// wherever it runs.

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** `text` as the characters a person sees, in order: joined again, they are `text`. */
export const graphemes = (text: string): string[] => Array.from(SEGMENTER.segment(text), part => part.segment)
