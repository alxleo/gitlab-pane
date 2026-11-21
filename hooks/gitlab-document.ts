// How a document is put together: its operation, then the fragments it uses, found by following its spreads. GitLab refuses
// a document that defines a fragment it does not use, and one that uses a fragment it does not define, so the list of
// fragments is read off the text rather than kept beside it by hand.

/**
 * A named spread, `...MrFields`, which GraphQL also reads with space between the dots and the name, or a lowercase name.
 * An inline fragment, `... on Type`, is not one: `on` is the one name a fragment may not have.
 */
const SPREAD = /\.\.\.\s*(?!on\b)([A-Z_a-z]\w*)/gu

/** The name a fragment's text defines. */
function nameOf(fragment: string): string {
  const name = /^\s*fragment\s+(\w+)\s+on\s/u.exec(fragment)?.[1]
  if (name === undefined) {
    throw new Error(`not a fragment: ${fragment.trim().slice(0, 60)}`)
  }
  return name
}

/**
 * The text sent for `operation`: the operation, then every fragment of `family` it spreads, and those they spread in turn,
 * in the order `family` lists them. A spread `family` has no fragment for throws, as GitLab would refuse the document.
 */
export function documentOf(operation: string, family: readonly string[]): string {
  const byName = new Map(family.map(fragment => [nameOf(fragment), fragment]))
  const used = new Set<string>()
  const follow = (text: string): void => {
    for (const [, name = ''] of text.matchAll(SPREAD)) {
      const fragment = byName.get(name)
      if (fragment === undefined) {
        throw new Error(`the document spreads ${name}, which its family of fragments lacks`)
      }
      if (!used.has(name)) {
        used.add(name)
        follow(fragment)
      }
    }
  }
  follow(operation)
  return operation + family.filter(fragment => used.has(nameOf(fragment))).join('')
}
