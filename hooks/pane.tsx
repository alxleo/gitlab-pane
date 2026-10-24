import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import {
  STAGE_COLOURS,
  ago,
  botName,
  byAttention,
  duration,
  excerpt,
  lead,
  personTone,
  pinKey,
  pipelineTime,
  plural,
  ranFor,
  rank,
  rowBadges,
  shortTitle,
  stageTone,
  statusMark,
  ticketOf,
} from './ci'
import { drawInbox } from './inbox-pane'
import { ticketUrl } from './jira'
import { filterRepo, quietly, refresh, showPerson, toggle, toggleWake, view } from './read'

import type { Badge, Tone } from './ci'
import type { Job, MrCard, Note, Person, Stage } from '../types'

const updatedLine = (age: string): string => (age === 'now' ? 'updated just now' : `updated ${age} ago`)

/** Keeps a hover scope inside its 64 characters whatever the project path or username. */
const shortHash = (text: string): string =>
  [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7).toString(36)

const REVIEW_STATE: Record<string, string> = {
  approved: 'approved',
  requested_changes: 'requested changes',
  reviewed: 'reviewed',
  review_started: 'reviewing',
  reviewing: 'reviewing',
  commented: 'commented',
  unreviewed: 'not reviewed yet',
  unapproved: 'withdrew approval',
}

const STATUS_WORD: Record<string, string> = {
  success: 'passed',
  failed: 'failed',
  running: 'running',
  pending: 'queued',
  created: 'not started',
  manual: 'waiting on a manual job',
  scheduled: 'scheduled',
  skipped: 'skipped',
  canceled: 'canceled',
}

/** Jobs worth a look first: hard failures, then what runs, then what waits, then what passed. */
const JOB_ORDER = ['failed', 'running', 'amber', 'pending', 'manual', 'created', 'success', 'skipped', 'canceled']

const jobKind = (job: Job) => (job.status === 'failed' && job.allowFailure ? 'amber' : job.status)

const jobMark = (job: Job): { glyph: string; tone: Tone } =>
  jobKind(job) === 'amber' ? { glyph: '⚠', tone: 'warning' } : statusMark(job.status)

const JOBS_SHOWN = 6
const MINE_SHOWN = 10

/** An MR card's border by `rank`: needs you, moving, waiting on others, ready. */
const URGENCY: Tone[] = ['error', 'suggestion', 'warning', 'success']

/** What a link opens, said before its words: a Link holds text alone, and an emoji costs two characters, a logo hundreds. */
const LINK = { mr: '🔀', jira: '🎫', repo: '📁', pipeline: '🚦', comment: '💬' } as const

const xml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;')

/**
 * The desktop app draws nothing for a tree past 100,000 characters serialized (a 381,164-character one left the pane
 * blank). The engine adds up to about 6,000 of press handles and hover stamps to what this measures, so the app gets
 * about 91,000 at most: rows, then open detail, then hover cards, then avatars, in order of what needs Alex.
 */
const DRAWING_BUDGET = 85_000

/** What the repo filter, headings and footer take, with room to spare for a long list of repos. */
const CHROME_SIZE = 6_000

/** A tree's size as the app receives it. */
const measure = (tree: unknown): number => {
  try {
    return JSON.stringify(tree)?.length ?? 0
  } catch {
    return DRAWING_BUDGET
  }
}

/** The GitLab pane: what each MR waits on at a glance, its detail a pointer away. It draws; read.ts holds the state. */
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const elements = $.ui.resolve(e)
  const { Box, Text, Button, Link, Markdown } = elements
  // The terminal's table still answers `Svg`, drawn as an empty box, so the surface decides.
  const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
  const { pinned, rows, tickets, usual, avatars, expanded, chosen, repoFilter, poll, isWaking, now } = await view($)
  const pinnedKeys = new Set(pinned.map(pinKey))
  const repos = [...rows.reduce((count, row) => count.set(row.project, (count.get(row.project) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
  const homeRepo = rows.find(row => pinnedKeys.has(row.key))?.project ?? repos[0]?.[0]
  const shown = rows.filter(row => !repoFilter || row.project === repoFilter)
  const session = shown.filter(row => pinnedKeys.has(row.key)).sort(byAttention)
  const mine = shown.filter(row => !pinnedKeys.has(row.key) && !row.isDraft).sort(byAttention)
  const drafts = shown.filter(row => !pinnedKeys.has(row.key) && row.isDraft).sort(byAttention)
  const showDrafts = expanded.includes('drafts')
  // Past this many, the least pressing of Mine fold behind a button, so the pane's size stays bounded.
  const showMore = expanded.includes('more')
  const mineShown = showMore ? mine : mine.slice(0, MINE_SHOWN)
  const repoName = (project: string) => rows.find(row => row.project === project)?.repo.name ?? project

  // The desktop paints no background on a floating Box, so a card opens in the flow under its line instead.
  // A scope groups a trigger with its card, so neither needs a key; keys would only spend the character budget.
  const trigger = (scope: string, child: RenderChildren) => (
    <Box flexDirection="row" alignItems="center" flexShrink={0} hover={{ scope }}>
      {child}
    </Box>
  )
  // Inside an MR's bordered card a second border would nest, so a reveal is set off by its indent alone.
  const reveal = (scope: string, card: RenderChildren) => (
    <Box display="none" hover={{ scope, display: 'flex' }} flexDirection="column" paddingLeft={2} paddingY={1}>
      {card}
    </Box>
  )

  /** Who or what, where and when on one line with its link. */
  const byline = (key: string, who: string, where: string, url: string) => (
    <Box key={key} flexDirection="row" gap={1}>
      <Box flexShrink={0}>
        <Text bold>{who}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {where}
        </Text>
      </Box>
      <Link href={url}>{LINK.comment}</Link>
    </Box>
  )
  const noteLine = (note: Note, who = note.author) => (
    <Box flexDirection="column" marginTop={1}>
      {byline('who', who, [note.where, ago(note.at, now)].filter(Boolean).join(' · '), note.url)}
      <Text>{excerpt(note.body)}</Text>
    </Box>
  )
  const noteKind = (note: Note) => (note.isOpen ? 'open thread' : 'comment')

  const personCard = (person: Person) => {
    const latest = person.notes[0]
    return [
      <Box flexDirection="row" gap={1}>
        <Text bold>{person.name}</Text>
        <Text dimColor>{`@${person.username}`}</Text>
      </Box>,
      <Text color={personTone(person)}>
        {[REVIEW_STATE[person.state] ?? person.state, person.openThreads > 0 ? plural(person.openThreads, 'open thread') : '']
          .filter(Boolean)
          .join(' · ')}
      </Text>,
      ...(latest ? [noteLine(latest, noteKind(latest))] : []),
      <Box marginTop={latest ? 1 : 0}>
        <Text dimColor>
          {person.notes.length > 1 ? `Click ${person.initials} for all ${person.notes.length} comments.` : person.notes.length === 1 ? `Click ${person.initials} to read it whole.` : 'No comments.'}
        </Text>
      </Box>,
    ]
  }

  /** `build · passed · ran 3m`; a stage none of whose jobs ran says only its state. */
  const stageLine = (stage: Stage) => {
    const ran = ranFor([stage], now)
    const timing = ran === 0 ? '' : stage.status === 'running' ? ` · running ${duration(ran)}` : ` · ran ${duration(ran)}`
    return `${stage.name} · ${STATUS_WORD[stage.status] ?? stage.status}${timing}`
  }

  /** The jobs worth opening across the pipeline: what failed, runs or waits on a person, each linked. */
  const pipelineJobs = (stages: Stage[]) => {
    const open = stages
      .flatMap(stage => stage.jobs)
      .filter(job => ['failed', 'running'].includes(job.status) || (job.status === 'manual' && !job.allowFailure))
      .sort((a, b) => JOB_ORDER.indexOf(jobKind(a)) - JOB_ORDER.indexOf(jobKind(b)))
    return [
      ...open.slice(0, JOBS_SHOWN).map((job, i) => {
        const mark = jobMark(job)
        return (
          <Box key={`j${i}`} flexDirection="row" gap={1}>
            <Text color={mark.tone}>{mark.glyph}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Link href={job.url}>{job.name}</Link>
            </Box>
            <Text dimColor>{job.startedAt ? duration(((job.finishedAt ? Date.parse(job.finishedAt) : now) - Date.parse(job.startedAt)) / 1000) : ''}</Text>
          </Box>
        )
      }),
      ...(open.length > JOBS_SHOWN ? [<Text dimColor>{`+${open.length - JOBS_SHOWN} more`}</Text>] : []),
    ]
  }

  /** One line or a few per marker, the markers' glyphs leading: what stands between the MR and a merge. */
  const blockerLines = (row: MrCard, badge: Badge) => {
    const pipeline = row.pipeline
    const head = (words: string) => (
      <Text bold color={badge.tone === 'subtle' ? undefined : badge.tone}>
        {`${badge.glyph} ${words}`}
      </Text>
    )
    switch (badge.kind) {
      case 'threads': {
        const held = new Set(row.people.map(person => person.username))
        const loose = row.openThreads.filter(note => !held.has(note.author))
        return [head(plural(loose.length, 'open thread')), ...loose.slice(0, 3).map(note => noteLine(note))]
      }
      case 'bots':
        return [
          head('Bots hold the merge'),
          ...row.bots.changesBy.map(name => <Text>{`${botName(name)} requested changes`}</Text>),
          ...row.bots.threads.map(note => byline(`b-${note.url}`, botName(note.author), note.where ?? ago(note.at, now), note.url)),
        ]
      case 'failed':
        return [head('Failed jobs'), ...(pipeline?.failed ?? []).map(job => <Link href={job.url}>{job.name}</Link>)]
      case 'amber':
        return [head('Failed, allowed to fail'), ...(pipeline?.amber ?? []).map(job => <Link href={job.url}>{job.name}</Link>)]
      case 'manual':
        return [head(`Waiting on ${pipeline?.blockedOn.join(', ') ?? 'a manual job'}`)]
      case 'conflicts':
        return [head(`Conflicts with ${row.branch.target}`)]
      case 'rebase':
        return [head(`Needs a rebase onto ${row.branch.target}`)]
      case 'approvals':
        return [head(`Approvals ${badge.count}${row.approvers.length > 0 ? `: ${row.approvers.join(', ')}` : ''}`)]
      case 'ready':
        return [head('Ready to merge')]
      default:
        return []
    }
  }

  // One image per row, each square's name, state and time in its own tooltip, costs far less of the drawing's
  // 100,000 characters than a hover card per square. A surface without Svg gets one coloured glyph per stage.
  const strip = (stages: Stage[]) => {
    if (!Svg) {
      return (
        <Box flexDirection="row" flexShrink={0}>
          {stages.map(stage => (
            <Text color={stageTone(stage.status)}>■</Text>
          ))}
        </Box>
      )
    }
    const squares = stages
      .map(
        (stage, i) =>
          `<use href='#s' x='${i * 12}' fill='${STAGE_COLOURS[stageTone(stage.status)]}'><title>${xml(stageLine(stage))}</title></use>`
      )
      .join('')
    const width = stages.length * 12
    return (
      <Svg
        isInteractive
        width={width}
        height={10}
        alt={`${stages.length} stages`}
        source={`<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='10'><defs><rect id='s' width='10' height='10' rx='2'/></defs>${squares}</svg>`}
      />
    )
  }

  /** Their avatar ringed in the colour of where they stand; a coloured dot where there is no picture or no room. */
  const face = (person: Person, isFocused: boolean, picture: string | undefined) => {
    if (!Svg || !picture) {
      return <Text color={personTone(person)}>{isFocused ? '◉' : '●'}</Text>
    }
    return (
      <Svg
        width={18}
        height={18}
        alt={person.name}
        source={`<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><clipPath id='c'><circle cx='9' cy='9' r='7'/></clipPath><image href='${picture}' x='2' y='2' width='14' height='14' clip-path='url(#c)'/><circle cx='9' cy='9' r='8' fill='none' stroke='${STAGE_COLOURS[personTone(person)]}' stroke-width='${isFocused ? 2 : 1.5}'/></svg>`}
      />
    )
  }

  const row = (mr: MrCard) => {
    const isOpen = expanded.includes(mr.key)
    const focus = isOpen ? mr.people.find(person => person.username === chosen[mr.key]) : undefined
    const mark = statusMark(mr.pipeline?.status)
    const ticket = ticketOf(mr.title)
    const ticketLink = ticket ? ticketUrl(ticket) : null
    const jira = ticket ? tickets[ticket] : undefined
    const pipeline = mr.pipeline
    const isStacked = !['main', 'master'].includes(mr.branch.target)
    // A card opens right under the line its trigger is on, so the pointer can move into it. Every trigger on the first
    // line shares one card, and the second line's markers share another: each card's wrapper costs the drawing ~200
    // characters, and the app draws nothing past 100,000.
    const scope = (what: string) => `${what}-${mr.iid}-${shortHash(mr.project)}`
    const about = scope('l1')
    const blocks = scope('b')
    const list = rowBadges(mr)
    // The desktop app refuses a whole drawing over one element it does not take, so controls hold plain strings:
    // a Link's text and a Button's label, never styled Text inside them. The title leads, so titles line up.
    const line1 = (
      <Box flexDirection="row" gap={1}>
        <Button key={scope('open')} plain label={isOpen ? '▾' : '▸'} onPress={() => toggle($, mr.key)} />
        <Box flexGrow={1} flexShrink={1} hover={{ scope: about }}>
          <Text weight="semibold" wrap="truncate-end">
            {shortTitle(mr.title)}
          </Text>
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
        {ticket && (ticketLink ? <Link href={ticketLink}>{`${LINK.jira} ${ticket}`}</Link> : <Text dimColor>{ticket}</Text>)}
        {!repoFilter && mr.project !== homeRepo && <Link href={mr.repo.url}>{`${LINK.repo} ${mr.repo.name}`}</Link>}
      </Box>
    )
    // What blocks the merge, worst first, in words; the hover lists every marker.
    const blocker = list[0]
    const under1 = [
      reveal(about, [
        <Text bold>{shortTitle(mr.title)}</Text>,
        <Text dimColor>{`${mr.branch.source} → ${mr.branch.target}${isStacked ? ' (stacked)' : ''}${mr.diff ? ` · +${mr.diff.additions} −${mr.diff.deletions} · ${plural(mr.diff.files, 'file')}` : ''}`}</Text>,
        ...(mr.description ? [<Text>{lead(mr.description, 160)}</Text>] : []),
        ...(pipeline
          ? [
              <Text bold color={mark.tone}>
                {`${mark.glyph} Pipeline ${STATUS_WORD[pipeline.status] ?? pipeline.status} · ${pipelineTime(mr, now, usual[mr.project])}`}
              </Text>,
              ...pipelineJobs(pipeline.stages),
            ]
          : []),
        ...(ticket && ticketLink ? [<Text>{jira ?`${ticket} · ${jira.type} · ${jira.status}: ${jira.summary}` : `${ticket}: not read from Jira yet`}</Text>] : []),
        ...(mr.project !== homeRepo ? [<Text dimColor>{mr.project}</Text>] : []),
      ]),
    ]
    const personScope = (person: Person) => scope(`p${shortHash(person.username)}`)
    const under2: RenderChildren[] = [
      ...(list.length > 0 ? [reveal(blocks, list.flatMap(badge => blockerLines(mr, badge)))] : []),
      ...mr.people.map(person => reveal(personScope(person), personCard(person))),
    ]
    const pictures = mr.people.some(person => person.avatarUrl && avatars[person.avatarUrl])
    // Drawn with and without pictures, so the room the cards leave decides which; each costs about 1,300 characters.
    const line2 = (withPictures: boolean) => (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2}>
        {links}
        {pipeline && pipeline.stages.length > 0 && strip(pipeline.stages)}
        {pipeline ? (
          <Link href={pipeline.url}>{`${LINK.pipeline} ${pipelineTime(mr, now, usual[mr.project])}`}</Link>
        ) : (
          <Text dimColor>no pipeline</Text>
        )}
        {blocker && (
          <Box flexShrink={0} hover={{ scope: blocks }}>
            <Text color={blocker.tone}>{`${blocker.glyph} ${blocker.words}${list.length > 1 ? ` +${list.length - 1}` : ''}`}</Text>
          </Box>
        )}
        {mr.people.map(person =>
          trigger(personScope(person), [
            face(person, focus?.username === person.username, withPictures && person.avatarUrl ? avatars[person.avatarUrl] : undefined),
            <Button
              key={scope(`person-${person.username}`)}
              plain
              label={`${person.initials}${person.openThreads > 0 ? ` ${person.openThreads}` : ''}`}
              onPress={() => quietly(showPerson($, mr.key, person.username))}
            />,
          ])
        )}
      </Box>
    )
    const detail = focus ? (
      <Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
        <Text bold>{`${focus.name} · ${REVIEW_STATE[focus.state] ?? focus.state} · ${plural(focus.notes.length, 'comment')}`}</Text>
        {focus.notes.map(note => (
          <Box key={`pn-${note.url}`} flexDirection="column">
            {byline('who', noteKind(note), [note.where, ago(note.at, now)].filter(Boolean).join(' · '), note.url)}
            <Markdown text={note.body} />
          </Box>
        ))}
      </Box>
    ) : (
      <Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {pipeline && <Link href={pipeline.url}>{`${LINK.pipeline} pipeline ${pipeline.id}`}</Link>}
          {pipeline?.failed.map(job => <Link href={job.url}>{`✗ ${job.name}`}</Link>)}
          {pipeline?.amber.map(job => <Link href={job.url}>{`⚠ ${job.name}`}</Link>)}
        </Box>
        {mr.openThreads.map(note => (
          <Box key={`t-${note.url}`} flexDirection="column">
            {byline('who', note.author, [note.where, ago(note.at, now)].filter(Boolean).join(' · '), note.url)}
            <Markdown text={note.body} />
          </Box>
        ))}
        {mr.people.length > 0 && <Text dimColor>Click someone's initials to read only their comments.</Text>}
      </Box>
    )
    return {
      key: mr.key,
      line1,
      under1,
      line2: line2(false),
      faces: pictures ? line2(true) : null,
      under2,
      detail: isOpen ? detail : null,
    }
  }

  // Rows come in order of what needs Alex, and take the room in that order: the rows themselves, then open rows'
  // detail, then hover cards, then avatars. Rows that do not fit at all are left out and counted.
  const built = [...session, ...mineShown, ...(showDrafts ? drafts : [])].map(row)
  // The inbox keeps itself inside its own budget; what it takes comes off the rows' room.
  const inbox = await drawInbox($, e)
  let room = DRAWING_BUDGET - CHROME_SIZE - measure(inbox)
  /** Takes the room `tree` needs past what `instead` already took. */
  const fits = (tree: unknown, instead?: unknown) => {
    const size = measure(tree) - (instead === undefined ? 0 : measure(instead))
    if (size > room) {
      return false
    }
    room -= size
    return true
  }
  const drawn = new Set(built.filter(part => fits([part.line1, part.line2])).map(part => part.key))
  const left = built.length - drawn.size
  const withDetail = new Set(built.filter(part => drawn.has(part.key) && part.detail && fits(part.detail)).map(part => part.key))
  const withCards = new Set(built.filter(part => drawn.has(part.key) && fits([part.under1, part.under2])).map(part => part.key))
  const withFaces = new Set(built.filter(part => drawn.has(part.key) && part.faces && fits(part.faces, part.line2)).map(part => part.key))
  const draw = (mr: MrCard) => {
    const part = built.find(one => one.key === mr.key)
    if (!part || !drawn.has(part.key)) {
      return null
    }
    const hasCards = withCards.has(part.key)
    return (
      <Box key={shortHash(part.key)} flexDirection="column" borderStyle="round" borderColor={URGENCY[rank(mr)]} paddingX={1}>
        {part.line1}
        {hasCards && part.under1}
        {withFaces.has(part.key) ? part.faces : part.line2}
        {hasCards && part.under2}
        {part.detail && (withDetail.has(part.key) ? part.detail : <Text dimColor>Too much is open to draw this too; close another row.</Text>)}
      </Box>
    )
  }

  const status =
    poll.error !== null
      ? `GitLab read failed: ${poll.error}${poll.fetchedAt ? `; showing ${ago(new Date(poll.fetchedAt).toISOString(), now)} old data` : ''}`
      : poll.fetchedAt
        ? updatedLine(ago(new Date(poll.fetchedAt).toISOString(), now))
        : 'reading GitLab…'

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button key="repo-all" label={`All ${rows.length}`} variant={repoFilter ? 'secondary' : 'primary'} onPress={() => filterRepo($, repoFilter)} />
        {repos.map(([project, count]) => (
          <Button
            key={`repo-${project}`}
            label={`${repoName(project)} ${count}`}
            variant={repoFilter === project ? 'primary' : 'secondary'}
            onPress={() => filterRepo($, project)}
          />
        ))}
      </Box>
      {inbox}
      {session.length > 0 && <Text bold>This session</Text>}
      {session.map(draw)}
      <Text bold>{`Mine · ${mine.length}`}</Text>
      {mine.length === 0 && <Text dimColor>Nothing open here.</Text>}
      {mineShown.map(draw)}
      {mine.length > MINE_SHOWN && (
        <Button key="more" plain label={showMore ? '▾ Show fewer' : `▸ ${mine.length - MINE_SHOWN} more`} onPress={() => toggle($, 'more')} />
      )}
      {drafts.length > 0 && <Button key="drafts" plain label={`${showDrafts ? '▾' : '▸'} Drafts · ${drafts.length}`} onPress={() => toggle($, 'drafts')} />}
      {showDrafts && drafts.map(draw)}
      {left > 0 && <Text dimColor>{`${plural(left, 'more MR')} left out to stay within what the app draws; pick a repo above to see them.`}</Text>}
      <Box flexDirection="row" gap={2}>
        <Text color={poll.error !== null ? 'warning' : undefined} dimColor={poll.error === null} size="footnote">
          {status}
        </Text>
        <Button key="refresh" plain label="refresh" onPress={() => quietly(refresh($))} />
        <Button key="wake" plain label={isWaking ? 'wake Claude: on' : 'wake Claude: off'} onPress={() => toggleWake($)} />
      </Box>
    </Box>
  )
}
