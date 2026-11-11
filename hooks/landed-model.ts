// What the Mine tab says of the user's own MRs merged lately: one folded line, and a row each once it is opened. Pure, on
// plain data; the draw files only map it to elements.
import { LINK } from './drawing.ts'
import { ago, plural, shortTitle } from './format.ts'
import { shorten } from './graphemes.ts'
import { cardKey, projectOf } from './hosts.ts'
import { shortHash } from './identity.ts'
import { statusMark } from './status.ts'
import type { Glyph, Tone } from './status.ts'

import type { Landed } from '../types'

/** Letters of a merged MR's title its link says: enough to know it, short enough that a link, which cannot wrap, fits a narrow pane. */
const TITLE_ROOM = 36

/**
 * The most characters an open row draws to, which the list leaves room for in the drawing budget for each: five rows of the
 * longest title and addresses the model allows measured 3,440 in all, under 700 each.
 */
export const MERGED_ROW_SIZE = 700

type Link = { href: string; text: string }

/**
 * The build of the commit that landed: its mark in its status's colour, then where its pipeline is, or `none` when GitLab ran
 * none; or the words saying that the commit could not be told, so no build is drawn.
 */
type BuildFacts = { kind: 'mark'; glyph: Glyph; tone: Tone; link: Link | null } | { kind: 'unknown'; words: string }

export type MergedRow = {
  /** The MR's card key, unique across hosts, and the short form of it the row's box is keyed by. */
  key: string
  boxKey: string
  /** The MR's link, with what it was called. */
  mr: Link
  /** How long ago it merged. */
  ago: string
  build: BuildFacts
}

export type MergedModel = {
  /** Folded or open, then how many merged; while folded, also how many of their builds failed, so a failure never waits behind the fold. */
  label: string
  isOpen: boolean
  /** The rows of an open section; none while it is folded. */
  rows: MergedRow[]
}

/** What a row says where it cannot show its build, because GitLab did not say which commit the merge put on the branch. */
const UNKNOWN_BUILD = 'build unknown'

function buildOf(each: Landed): BuildFacts {
  if (each.sha === null) {
    return { kind: 'unknown', words: UNKNOWN_BUILD }
  }
  const { glyph, tone } = statusMark(each.build?.status)
  return { kind: 'mark', glyph, tone, link: each.build !== null ? { href: each.build.url, text: `${LINK.pipeline} ${each.targetBranch}` } : null }
}

/**
 * The merged section: the user's MRs merged lately that the list does not draw as cards (`cardKeys`), narrowed to the repo
 * picked, newest first. Only a failed build is said while it is folded: a healthy or running one stays in the rows, quiet. None
 * when there are none to show.
 */
export function mergedModel(landed: readonly Landed[], shown: { cardKeys: ReadonlySet<string>; repoFilter: string; isOpen: boolean; now: number }): MergedModel | null {
  const listed = landed.filter(
    each => !shown.cardKeys.has(cardKey(each.host, each.path, each.iid)) && (shown.repoFilter === '' || projectOf(each.host, each.path) === shown.repoFilter)
  )
  if (listed.length === 0) {
    return null
  }
  const failed = listed.filter(each => each.build?.status === 'failed').length
  const tally = failed > 0 && !shown.isOpen ? ` · ${plural(failed, 'build')} ✗` : ''
  return {
    label: `${shown.isOpen ? '▾' : '▸'} ${listed.length} merged${tally}`,
    isOpen: shown.isOpen,
    rows: shown.isOpen
      ? listed.map(each => ({
          key: cardKey(each.host, each.path, each.iid),
          boxKey: `merged-${shortHash(cardKey(each.host, each.path, each.iid))}`,
          mr: { href: each.url, text: `${LINK.mr} !${each.iid} ${shorten(shortTitle(each.title), TITLE_ROOM)}` },
          ago: ago(new Date(each.mergedAt).toISOString(), shown.now),
          build: buildOf(each),
        }))
      : [],
  }
}
