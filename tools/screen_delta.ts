// What a change did to a drawing, element by element: which parts of a scene's tree are as they were in the same scene
// drawn by another version of the mod, and which are new or changed. The screenshots then fade what stayed the same, so
// the change stands out in a pull request's picture.
//
// It compares elements, not pixels: an element that only moved (a row pushed down by a row above it that folded) is the
// same element, and stays faded, where a pixel diff would mark everything below the change.

/** A drawn element as the screenshots read it: its type, its props and its children. */
export type Drawn = { readonly type: string; readonly props: Readonly<Record<string, unknown>>; readonly children: readonly (Drawn | string)[] }

/** `same`: the element and all under it were drawn before, so it fades. `changed`: the element is new or not as it was. */
export type Mark = 'same' | 'changed'

/** An element and everything under it, as one string: two are the same drawing when these are equal. */
function deepOf(node: Drawn, known: Map<Drawn, string>): string {
  const cached = known.get(node)
  if (cached !== undefined) {
    return cached
  }
  const made = JSON.stringify([node.type, node.props, node.children.map(child => (typeof child === 'string' ? child : deepOf(child, known)))])
  known.set(node, made)
  return made
}

/** An element on its own: its type, its props and its own words, not what the elements under it draw. */
const shallowOf = (node: Drawn): string => JSON.stringify([node.type, node.props, node.children.filter(child => typeof child === 'string')])

/**
 * Marks the elements of `tree` against `base`, the same scene drawn before. The highest element that was drawn before,
 * whole, anywhere in `base` is `same`. An element whose own props and words were drawn before, but not all under it, is
 * left unmarked and its children are marked in turn. Any other element is `changed`, and nothing under it is marked.
 * An element that `base` had and `tree` dropped draws nothing to mark: the picture shows what is drawn now.
 */
export function deltaMarks(tree: Drawn, base: Drawn): Map<Drawn, Mark> {
  const known = new Map<Drawn, string>()
  const wholes = new Set<string>()
  const owns = new Set<string>()
  const learn = (node: Drawn): void => {
    wholes.add(deepOf(node, known))
    owns.add(shallowOf(node))
    node.children.forEach(child => (typeof child === 'string' ? undefined : learn(child)))
  }
  learn(base)
  const marks = new Map<Drawn, Mark>()
  const mark = (node: Drawn): void => {
    if (wholes.has(deepOf(node, known))) {
      marks.set(node, 'same')
    } else if (owns.has(shallowOf(node))) {
      node.children.forEach(child => (typeof child === 'string' ? undefined : mark(child)))
    } else {
      marks.set(node, 'changed')
    }
  }
  mark(tree)
  return marks
}
