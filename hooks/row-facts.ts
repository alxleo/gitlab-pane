// What an MR card says that depends on the card alone, not on the time: its badges, verdict, words and the one comment it
// quotes. It is the costly part of a row, so `buildPane` works it out for the rows it draws and no others. Pure, on plain
// data.
import { rank, reviewTone, rowBadges, trailingOf, verdictOf } from './attention.ts'
import type { Badge, Verdict } from './attention.ts'
import { faceFacts } from './face-model.ts'
import type { FaceFacts } from './face-model.ts'
import { excerpt, shortTitle, ticketOf } from './format.ts'
import { shorten } from './graphemes.ts'
import { firstName } from './identity.ts'
import type { Tone } from './status.ts'

import type { MrCard, Person } from '../types'

/** Letters of a bot's name beside its face. */
const BOT_NAME_ROOM = 14
/** A quoted comment's words: a short one whole, on two lines of the pane at most; the page has a long one whole. */
const SAID_ROOM = 120

export type PersonFacts = {
  username: string
  isBot: boolean
  initials: string
  openThreads: number
  /** A first name where it is clear, else the initials; `initials` is what a surface without pictures uses. */
  call: string
  face: FaceFacts
}

/** The comment a card quotes: who, by first name, and the start of their words. */
type Said = { username: string; who: string; words: string }

export type CardFacts = {
  key: string
  rank: number
  tone: Tone
  title: string
  ticket: string | null
  /** The markers on the row: what stands before a merge, less what people's icons speak for. */
  row: Badge[]
  verdict: Verdict | null
  /** The markers that trail GitLab's verdict, which covers the rest. */
  trailing: Badge[]
  said: Said | null
  people: PersonFacts[]
  hasPictures: boolean
}

const calledBy = (person: Person): string => {
  if (person.isBot) {
    return shorten(person.name, BOT_NAME_ROOM)
  }
  const first = firstName(person.name, person.username)
  return first !== '' ? first : person.initials
}

const personFacts = (person: Person, picture: string | undefined): PersonFacts => ({
  username: person.username,
  isBot: person.isBot,
  initials: person.initials,
  openThreads: person.openThreads,
  call: calledBy(person),
  face: faceFacts(person, picture),
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

/** The card's facts; `avatars` are the pictures kept by URL, which a face is drawn with where there is room. */
export function cardFacts(card: MrCard, avatars: Readonly<Record<string, string>>): CardFacts {
  const list = rowBadges(card)
  const verdict = verdictOf(card)
  const people = card.people.map(person => personFacts(person, person.avatarUrl !== null ? avatars[person.avatarUrl] : undefined))
  return {
    key: card.key,
    rank: rank(card),
    tone: reviewTone(card),
    title: shortTitle(card.title),
    ticket: ticketOf(card.title),
    row: list,
    verdict,
    trailing: verdict !== null ? trailingOf(verdict, list) : [],
    said: saidOf(card.people),
    people,
    hasPictures: people.some(person => person.face.picture !== null),
  }
}
