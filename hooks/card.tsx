import type { EngineInterface, RenderChildren } from 'claude-code'

import { rowBadges, verdictOf } from './attention'
import { blockerLines, JOBS_SHOWN, pipelineJobs } from './blockers'
import { showPerson, toggle } from './choices'
import { LINK, titleKey } from './drawing'
import { face, personCard, REVIEW_STATE } from './faces'
import { ago, bodyOf, lead, pipelineTime, plural, shortTitle, ticketOf } from './format'
import { projectLabel } from './hosts'
import { firstName, shortHash } from './identity'
import { ticketUrl } from './jira'
import { joins, markdown, reveal, trigger } from './kit'
import type { Kit } from './kit'
import { byline, noteKind, whereAndWhen } from './notes'
import { openReading } from './panes'
import { quietly } from './failures'
import { statusMark } from './status'
import { STATUS_WORD, strip } from './strip'

import type { MrCard, Person, Ticket, Usual } from '../types'

/** An open thread's words in its card; its 💬 link opens it whole. */
const THREAD_ROOM = 500

/** Letters of a bot's name beside its face. */
const BOT_NAME_ROOM = 14

/** What a card draws beside the MR itself: what the person opened, and what was read about its tickets, times and faces. */
export type CardContext = {
  expanded: string[]
  chosen: Record<string, string>
  tickets: Record<string, Ticket>
  usual: Record<string, Usual>
  avatars: Record<string, string>
  /** The start of a ticket's link; empty while no Jira site is set. */
  browse: string
  /** The repo most cards belong to, whose name a card leaves out. */
  homeRepo: string | undefined
  repoFilter: string
}

/** A name for a person beside their face: a first name where it is clear, else their initials. */
function callNames(kit: Kit, people: readonly Person[]): string[] {
  // Beside a face that already shows the initials, a first name reads better; two of the same name keep initials.
  // Some GitLab names are written like handles ("Mel.Northcote"), so a dot or underscore ends a first name too. A bot
  // keeps its whole name ("GitLab Duo"), cut short, since its first word alone often names only the vendor.
  const firstNames = people.map(person => {
    if (person.isBot) {
      return person.name.length > BOT_NAME_ROOM ? `${person.name.slice(0, BOT_NAME_ROOM - 1)}…` : person.name
    }
    const first = firstName(person.name, person.username)
    return first !== '' ? first : person.initials
  })
  return people.map((person, i) => {
    const first = firstNames[i] ?? person.initials
    return kit.Svg === undefined || firstNames.filter(name => name === first).length > 1 ? person.initials : first
  })
}

/**
 * One MR's card as parts the pane fits to its room: its two lines, the hover cards under each, the faces with pictures,
 * and the detail an opened card ends on.
 */
export function buildCard($: EngineInterface, kit: Kit, ctx: CardContext, mr: MrCard) {
  const { Box, Text, Button, Link } = kit
  const { now } = kit
  const isOpen = ctx.expanded.includes(mr.key)
  const focus = isOpen ? mr.people.find(person => person.username === ctx.chosen[mr.key]) : undefined
  const mark = statusMark(mr.pipeline?.status)
  const ticket = ticketOf(mr.title)
  const ticketLink = ticket !== null ? ticketUrl(ctx.browse, ticket) : null
  const jira = ticket !== null ? ctx.tickets[ticket] : undefined
  const pipeline = mr.pipeline
  const isStacked = !['main', 'master'].includes(mr.branch.target)
  // A card opens right under the line its trigger is on, so the pointer can move into it. Every trigger on the first
  // line shares one card, and the second line's markers share another: each card's wrapper costs the drawing ~200
  // characters, and the app draws nothing past 100,000.
  const scope = (what: string) => `${what}-${mr.iid}-${shortHash(mr.project)}`
  const about = scope('l1')
  const blocks = scope('b')
  const list = rowBadges(mr)
  // A card opens only onto what its lines do not already show: the description, failed jobs, open threads.
  const canOpen =
    mr.description.trim() !== '' || mr.openThreads.length > 0 || (pipeline?.failed.length ?? 0) > 0 || (pipeline?.amber.length ?? 0) > 0
  // The desktop app refuses a whole drawing over one element it does not take, so controls hold plain strings:
  // a Link's text and a Button's label, never styled Text inside them. The title opens the card, so it is a plain
  // Button with a disclosure arrow, not a link-blue title that reads as leaving for GitLab (🔀 !iid does that).
  // An open card ends on closing it, or on reading it whole on a page of its own, which has a drawing of its own.
  const foot = (
    <Box flexDirection="row" gap={2}>
      <Button key={scope('less')} plain label="▴ less" onPress={() => toggle($, mr.key)} />
      <Button key={scope('read')} plain label="read whole ›" onPress={() => openReading($, mr.key)} />
    </Box>
  )
  const line1 = (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Box flexGrow={1} flexShrink={1} hover={joins(kit, about)}>
        {canOpen ? (
          <Button key={titleKey(mr)} plain label={`${isOpen ? '▾' : '▸'} ${shortTitle(mr.title)}`} onPress={() => toggle($, mr.key)} />
        ) : (
          <Text weight="semibold" wrap="truncate-end">
            {shortTitle(mr.title)}
          </Text>
        )}
      </Box>
      <Text dimColor size="footnote">
        {ago(mr.updatedAt, now)}
      </Text>
    </Box>
  )
  // A Link takes no flex props, so this box keeps the links whole when the line wraps.
  const links = (
    <Box flexDirection="row" gap={1} flexShrink={0}>
      <Link href={mr.url}>{`${LINK.mr} !${mr.iid}`}</Link>
      {ticket !== null && (ticketLink !== null ? <Link href={ticketLink}>{`${LINK.jira} ${ticket}`}</Link> : <Text dimColor>{ticket}</Text>)}
      {ctx.repoFilter === '' && mr.project !== ctx.homeRepo && <Link href={mr.repo.url}>{`${LINK.repo} ${mr.repo.name}`}</Link>}
    </Box>
  )
  // What blocks the merge, worst first, in words; the hover lists every marker. GitLab's verdict, once read, is the
  // one word on whether it can merge (its rules can ignore a blocker the pane sees); the pane's other markers trail it.
  const blocker = list[0]
  const verdict = verdictOf(mr)
  const trailing = verdict !== null ? list.filter(badge => badge.kind !== 'ready' && !verdict.covers.includes(badge.kind)) : []
  const firstTrailing = trailing[0]
  const diffText = mr.diff !== null ? ` · +${mr.diff.additions} −${mr.diff.deletions} · ${plural(mr.diff.files, 'file')}` : ''
  const under1 = [
    reveal(kit, about, [
      <Text bold>{shortTitle(mr.title)}</Text>,
      <Text dimColor>{`${mr.branch.source} → ${mr.branch.target}${isStacked ? ' (stacked)' : ''}${diffText}`}</Text>,
      ...(mr.description !== '' ? [<Text>{lead(mr.description, 160)}</Text>] : []),
      ...(pipeline !== undefined
        ? [
            <Text bold color={mark.tone}>
              {`${mark.glyph} Pipeline ${STATUS_WORD[pipeline.status]} · ${pipelineTime(mr, now, ctx.usual[mr.project])}`}
            </Text>,
            ...pipelineJobs(kit, pipeline.stages),
          ]
        : []),
      ...(ticket !== null && ticketLink !== null
        ? [<Text>{jira !== undefined ? `${ticket} · ${jira.type} · ${jira.status}: ${jira.summary}` : `${ticket}: not read from Jira yet`}</Text>]
        : []),
      ...(mr.project !== ctx.homeRepo ? [<Text dimColor>{projectLabel(mr.host, mr.path)}</Text>] : []),
    ]),
  ]
  const personScope = (person: Person) => scope(`p${shortHash(person.username)}`)
  const under2: RenderChildren[] = [
    ...(list.length > 0 ? [reveal(kit, blocks, list.flatMap(badge => blockerLines(kit, mr, badge)))] : []),
    ...mr.people.map(person => reveal(kit, personScope(person), personCard(kit, person))),
  ]
  const pictureOf = (person: Person): string | undefined => (person.avatarUrl !== null ? ctx.avatars[person.avatarUrl] : undefined)
  const pictures = mr.people.some(person => pictureOf(person) !== undefined && pictureOf(person) !== '')
  const names = callNames(kit, mr.people)
  // Drawn with and without pictures, so the room the cards leave decides which; each costs about 1,300 characters.
  const line2 = (withPictures: boolean) => (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2}>
      {links}
      {pipeline !== undefined && pipeline.stages.length > 0 && strip(kit, pipeline.stages)}
      {pipeline !== undefined ? (
        <Link href={pipeline.url}>{`${LINK.pipeline} ${pipelineTime(mr, now, ctx.usual[mr.project])}`}</Link>
      ) : (
        <Text dimColor>no pipeline</Text>
      )}
      {verdict !== null ? (
        <Box flexDirection="row" gap={1} flexShrink={0} hover={joins(kit, blocks)}>
          <Text bold={verdict.tone === 'success'} color={verdict.tone}>
            {verdict.words}
          </Text>
          {firstTrailing !== undefined && (
            <Text dimColor>{`· ${firstTrailing.words}${trailing.length > 1 ? ` +${trailing.length - 1}` : ''}`}</Text>
          )}
        </Box>
      ) : (
        blocker !== undefined && (
          <Box flexShrink={0} hover={joins(kit, blocks)}>
            <Text color={blocker.tone}>{`${blocker.glyph} ${blocker.words}${list.length > 1 ? ` +${list.length - 1}` : ''}`}</Text>
          </Box>
        )
      )}
      {mr.people.map((person, i) =>
        trigger(kit, personScope(person), [
          face(kit, person, focus?.username === person.username, withPictures ? pictureOf(person) : undefined),
          <Button
            key={scope(`person-${person.username}`)}
            plain
            label={`${names[i] ?? person.initials}${person.openThreads > 0 ? ` ${person.openThreads}` : ''}`}
            onPress={() => quietly($, showPerson($, mr.key, person.username))}
          />,
        ])
      )}
    </Box>
  )
  const failedAndAmber = pipeline === undefined ? 0 : pipeline.failed.length + pipeline.amber.length
  const detail =
    focus !== undefined ? (
      <Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
        <Text bold>{`${focus.name} · ${REVIEW_STATE[focus.state]} · ${plural(focus.notes.length, 'comment')}`}</Text>
        {focus.notes.map(note => (
          <Box key={`pn-${note.url}`} flexDirection="column">
            {byline(kit, 'who', noteKind(note), whereAndWhen(note, now), note.url)}
            {markdown(kit, bodyOf(note.body, 1_500))}
          </Box>
        ))}
        {foot}
      </Box>
    ) : (
      <Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
        {mr.description.trim() !== '' && markdown(kit, bodyOf(mr.description, 400))}
        {pipeline !== undefined && failedAndAmber > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {[...pipeline.failed.map(job => ({ job, glyph: '✗' })), ...pipeline.amber.map(job => ({ job, glyph: '⚠' }))]
              .slice(0, JOBS_SHOWN)
              .map(({ job, glyph }) => (
                <Link href={job.url}>{`${glyph} ${job.name}`}</Link>
              ))}
            {failedAndAmber > JOBS_SHOWN && <Link href={pipeline.url}>{`+${failedAndAmber - JOBS_SHOWN} more`}</Link>}
          </Box>
        )}
        {mr.openThreads.map(note => (
          <Box key={`t-${note.url}`} flexDirection="column">
            {byline(kit, 'who', note.author, whereAndWhen(note, now), note.url)}
            {markdown(kit, bodyOf(note.body, THREAD_ROOM))}
          </Box>
        ))}
        {mr.people.length > 0 && <Text dimColor>Click a name to read only their comments.</Text>}
        {foot}
      </Box>
    )
  return {
    key: mr.key,
    line1,
    under1,
    line2: line2(false),
    faces: pictures ? line2(true) : null,
    under2,
    canOpen,
    detail: isOpen && (canOpen || focus !== undefined) ? detail : null,
  }
}
