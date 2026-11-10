/** The same avatar at `px` pixels: GitLab resizes its uploads by `width`, Gravatar by `s`. */
export function sizedAvatar(url: string, px: number): string {
  const [base = url, query = ''] = url.split('?')
  if (!/gravatar\.com\//u.test(base)) {
    return `${base}?width=${px}`
  }
  return `${base}?${[`s=${px}`, ...query.split('&').filter(pair => pair !== '' && !pair.startsWith('s='))].join('&')}`
}

const PICTURE_TYPES: [string, string][] = [
  ['iVBOR', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
]

/** A picture's base64 as a `data:` URI typed by its first bytes; null for anything else, or past `most` characters. */
export function pictureUri(base64: string, most: number): string | null {
  const bytes = base64.replace(/\s+/gu, '')
  const type = PICTURE_TYPES.find(([magic]) => bytes.startsWith(magic))?.[1]
  return type !== undefined && bytes.length <= most ? `data:${type};base64,${bytes}` : null
}
