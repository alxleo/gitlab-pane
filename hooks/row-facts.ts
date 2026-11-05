// What an MR card says that depends on the card alone, not on the time or on what is open: its badges, verdict, words and
// the Markdown cut from its description and notes. It is the costly part of a row, and the same until the card changes,
// so `data.ts` derives it from the rows: a drawing reads it without rebuilding it. Pure, on plain data.
import { badges, personTone, rank, reviewTone, rowBadges, trailingOf, verdictOf } from './attention.ts'
import type { Badge, Verdict } from './attention.ts'
import { faceFacts, REVIEW_STATE } from './face-model.ts'
import type { FaceFacts } from './face-model.ts'
import { bodyOf, excerpt, lead, plural, shortTitle, ticketOf } from './format.ts'
import { firstName } from './identity.ts'
import type { MarkdownText } from './markdown.ts'
import type { Tone } from './status.ts'

import type { MrCard, Note, Person } from '../types'

/** Letters of a bot's name beside its face. */
const BOT_NAME_ROOM = 14
/** An open thread's words in its card; its 💬 link opens it whole. */
const THREAD_ROOM = 500
/** A person's comment in the card opened on their words. */
const NOTE_ROOM = 1_500
const DESCRIPTION_ROOM = 400
const LEAD_ROOM = 160

/** A note with the words it is drawn with cut once: the excerpt a hover shows, the Markdown a card opens onto. */
export type NoteFacts = {
  author: string
  url: string
  at: string
  where: string | undefined
  isOpen: boolean
  excerpt: string
  /** Cut to a thread's room. */
  thread: MarkdownText
  /** Cut to a person's comment's room. */
  comment: MarkdownText
}

export type PersonFacts = {
  username: string
  name: string
  isBot: boolean
  initials: string
  openThreads: number
  tone: Tone
  standing: string
  /** `bot`, `@handle`, or nothing where the name already says it. */
  tag: string | null
  /** A first name where it is clear, else the initials; `initials` is what a surface without pictures uses. */
  call: string
  notes: NoteFacts[]
  face: FaceFacts
  state: Person['state']
}

export type CardFacts = {
  key: string
  rank: number
  tone: Tone
  title: string
  ticket: string | null
  isStacked: boolean
  canOpen: boolean
  badges: Badge[]
  /** The markers on the row; `badges` less the ones people's icons speak for. */
  row: Badge[]
  verdict: Verdict | null
  /** The markers that trail GitLab's verdict, which covers the rest. */
  trailing: Badge[]
  lead: string
  detail: MarkdownText | null
  threads: NoteFacts[]
  /** Open threads no person's icon holds. */
  loose: NoteFacts[]
  people: PersonFacts[]
  hasPictures: boolean
}

const noteFacts = (note: Note): NoteFacts => ({
  author: note.author,
  url: note.url,
  at: note.at,
  where: note.where,
  isOpen: note.isOpen,
  excerpt: excerpt(note.body),
  thread: bodyOf(note.body, THREAD_ROOM),
  comment: bodyOf(note.body, NOTE_ROOM),
})

const calledBy = (person: Person): string => {
  if (person.isBot) {
    return person.name.length > BOT_NAME_ROOM ? `${person.name.slice(0, BOT_NAME_ROOM - 1)}…` : person.name
  }
  const first = firstName(person.name, person.username)
  return first !== '' ? first : person.initials
}

const tagOf = (person: Person): string | null => {
  // A name written like the handle ("Mel.Northcote") would say it twice.
  const isHandle = person.name.toLowerCase() === person.username.toLowerCase()
  return person.isBot ? 'bot' : isHandle ? null : `@${person.username}`
}

const personFacts = (person: Person, picture: string | undefined): PersonFacts => {
  const standing = [REVIEW_STATE[person.state], person.openThreads > 0 ? plural(person.openThreads, 'open thread') : ''].filter(part => part !== '')
  return {
    username: person.username,
    name: person.name,
    isBot: person.isBot,
    initials: person.initials,
    openThreads: person.openThreads,
    tone: personTone(person),
    standing: standing.join(' · '),
    tag: tagOf(person),
    call: calledBy(person),
    notes: person.notes.map(noteFacts),
    face: faceFacts(person, picture),
    state: person.state,
  }
}

/** The card's facts; `avatars` are the pictures kept by URL, which a face is drawn with where there is room. */
export function cardFacts(card: MrCard, avatars: Readonly<Record<string, string>>): CardFacts {
  const pipeline = card.pipeline
  const list = rowBadges(card)
  const verdict = verdictOf(card)
  const held = new Set(card.people.map(person => person.username))
  const threads = card.openThreads.map(noteFacts)
  const people = card.people.map(person => personFacts(person, person.avatarUrl !== null ? avatars[person.avatarUrl] : undefined))
  return {
    key: card.key,
    rank: rank(card),
    tone: reviewTone(card),
    title: shortTitle(card.title),
    ticket: ticketOf(card.title),
    isStacked: !['main', 'master'].includes(card.branch.target),
    // A card opens only onto what its lines do not already show: the description, failed jobs, open threads.
    canOpen: card.description.trim() !== '' || card.openThreads.length > 0 || (pipeline?.failed.length ?? 0) > 0 || (pipeline?.amber.length ?? 0) > 0,
    badges: badges(card),
    row: list,
    verdict,
    trailing: verdict !== null ? trailingOf(verdict, list) : [],
    lead: card.description !== '' ? lead(card.description, LEAD_ROOM) : '',
    detail: card.description.trim() !== '' ? bodyOf(card.description, DESCRIPTION_ROOM) : null,
    threads,
    loose: threads.filter(note => !held.has(note.author)),
    people,
    hasPictures: people.some(person => person.face.picture !== null),
  }
}
