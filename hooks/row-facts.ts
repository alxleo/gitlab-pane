// What an MR card says that depends on the card alone, not on the time: its badges, verdict, words, the one comment it
// quotes and the head a merge would take. It is the costly part of a row, so `buildPane` works it out for the rows it draws and no others. Pure, on plain
// data.
import { isMergeable, rank, rowBadges, trailingOf, verdictOf } from './attention'
import type { Badge, Verdict } from './attention'
import { LINK } from './drawing'
import { faceFacts, suggestedFace, suggestedOf } from './face-model'
import type { FaceFacts, PersonFacts } from './face-model'
import { excerpt, shortTitle, ticketOf } from './format'
import { shorten } from './graphemes'
import { firstName } from './identity'

import type { MrCard, Person, Suggestion } from '../types'

/** Letters of a bot's name beside its face. */
const BOT_NAME_ROOM = 14
/** A quoted comment's words: a short one whole, on two lines of the pane at most; the page has a long one whole. */
const SAID_ROOM = 120

/** The comment a card quotes: who, by first name, and the start of their words. */
type Said = { username: string; who: string; words: string }

export type CardFacts = {
  key: string
  rank: number
  title: string
  ticket: string | null
  /** The markers on the row: what stands before a merge, less what people's icons speak for. */
  row: Badge[]
  verdict: Verdict | null
  /** The markers that trail GitLab's verdict, which covers the rest. */
  trailing: Badge[]
  said: Said | null
  people: PersonFacts[]
  /** Who the card suggests adding as a reviewer, their faces faded (`suggestedOf`). */
  suggested: PersonFacts[]
  hasPictures: boolean
  /** On an MR GitLab says can merge, the commit a merge would take, linked: what a press merges, seen before it. */
  head: { href: string; text: string } | null
}

/** Letters of a commit's id that name it, as GitLab shortens one. */
const SHORT_SHA = 8

/** The head a merge takes, where GitLab says the MR can merge and named the head its checks were made on. */
const headOf = (card: MrCard): CardFacts['head'] => {
  const head = card.merging?.head ?? ''
  return isMergeable(card.mergeStatus) && head !== '' ? { href: `${card.repo.url}/-/commit/${head}`, text: `${LINK.commit} ${head.slice(0, SHORT_SHA)}` } : null
}

const calledBy = (person: Person): string => {
  if (person.isBot) {
    return shorten(person.name, BOT_NAME_ROOM)
  }
  const first = firstName(person.name, person.username)
  return first !== '' ? first : person.initials
}

const personFacts = (person: Person, face: FaceFacts): PersonFacts => ({
  username: person.username,
  isBot: person.isBot,
  initials: person.initials,
  openThreads: person.openThreads,
  call: calledBy(person),
  face,
})

/** What a quote says of a comment with no words to quote: code (a suggestion is one) or pictures alone. */
const WORDLESS = 'code or a picture, no words'

/**
 * The latest open thread a person started, never a bot: the human feedback the card leads with, approved or not. A
 * person's notes lead with the open threads they started, newest first, so it is their first note, which a shared card
 * keeps too. `people` leaves out the MR's author, so neither the author's threads nor the replies in them are quoted.
 */
function saidOf(people: readonly Person[]): Said | null {
  const open = people.filter(person => !person.isBot && person.openThreads > 0).flatMap(person => person.notes.slice(0, 1).map(note => ({ person, note })))
  const latest = open.reduce<(typeof open)[number] | null>((best, each) => (best === null || each.note.at > best.note.at ? each : best), null)
  if (latest === null) {
    return null
  }
  const words = excerpt(latest.note.body, SAID_ROOM)
  return { username: latest.person.username, who: calledBy(latest.person), words: words !== '' ? words : WORDLESS }
}

/**
 * The card's facts; `avatars` are the pictures kept by URL, which a face is drawn with where there is room, and
 * `suggestions` who GitLab suggests as its reviewers.
 */
export function cardFacts(card: MrCard, avatars: Readonly<Record<string, string>>, suggestions: readonly Suggestion[] = []): CardFacts {
  const list = rowBadges(card)
  const verdict = verdictOf(card)
  const pictureOf = (person: Person): string | undefined => (person.avatarUrl !== null ? avatars[person.avatarUrl] : undefined)
  const people = card.people.map(person => personFacts(person, faceFacts(person, pictureOf(person))))
  const suggested = suggestedOf(card, suggestions).map(person => personFacts(person, suggestedFace(person, pictureOf(person))))
  return {
    key: card.key,
    rank: rank(card),
    title: shortTitle(card.title),
    ticket: ticketOf(card.title),
    row: list,
    verdict,
    trailing: verdict !== null ? trailingOf(verdict, list) : [],
    said: saidOf(card.people),
    people,
    suggested,
    hasPictures: [...people, ...suggested].some(person => person.face.picture !== null),
    head: headOf(card),
  }
}
