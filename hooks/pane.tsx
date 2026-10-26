import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import {
  CHROME_SIZE,
  DRAWING_BUDGET,
  LINK,
  STAGE_COLOURS,
  ago,
  bodyOf,
  botName,
  byAttention,
  cardKey,
  duration,
  excerpt,
  lead,
  measure,
  personTone,
  pinKey,
  pipelineTime,
  plural,
  ranFor,
  rank,
  reviewTone,
  rowBadges,
  shortHash,
  shortTitle,
  stageTone,
  statusMark,
  ticketOf,
  trailingWords,
  verdictOf,
} from './ci'
import { discMarks } from './avatar'
import { inboxView } from './inbox'
import { drawInbox } from './inbox-pane'
import { ticketUrl } from './jira'
import { filterRepo, leaveReading, openReading, openTab, quietly, refresh, showPerson, toggle, toggleWake, view } from './read'
import { drawReading } from './reading'

import type { Badge, Tone } from './ci'
import type { Job, MrCard, Note, Person, Stage } from '../types'

const updatedLine = (age: string): string => (age === 'now' ? 'updated just now' : `updated ${age} ago`)

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

/** The corner badge on a reviewer's face, and their mark where no Svg is drawn. */
const REVIEW_MARK: Record<string, { glyph: string; tone: Tone; path: string }> = {
  approved: { glyph: '✓', tone: 'success', path: 'M13.1 14.9l1.1 1.1 2.1-2.2' },
  requested_changes: { glyph: '✕', tone: 'error', path: 'M13.5 13.5l2.5 2.5m0-2.5l-2.5 2.5' },
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

const xml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;')

/** An open thread's words in its card; its 💬 link opens it whole. */
const THREAD_ROOM = 500

/** What each tab opens under: its own colour, icon and name, so which one is open reads at a glance. */
const VIEWS = {
  mine: { title: '🗂 Mine', about: 'Your open MRs, the most pressing first', colour: '#0969da' },
  inbox: { title: '📥 Inbox', about: 'News on the MRs you follow', colour: '#bf8700' },
} as const

/** The GitLab pane: what each MR waits on at a glance, its detail a pointer away. It draws; read.ts holds the state. */
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const elements = $.ui.resolve(e)
  const { Box, Text, Button, Link, Markdown } = elements
  // The terminal's table still answers `Svg`, drawn as an empty box, so the surface decides.
  const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
  const { pinned, rows: lastRead, tickets, usual, avatars, expanded, chosen, folds, repoFilter, tab, page, poll, isWaking, now } = await view($)
  // GitLab says an MR is no longer open before the authored list drops it.
  const rows = lastRead.filter(row => row.mergeStatus !== 'NOT_OPEN')
  // Only the open tab or page is drawn, so the MR list, the inbox and one MR read whole each have all the app draws.
  const isInbox = tab === 'inbox'
  const reading = lastRead.find(row => row.key === page)
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
          {person.notes.length > 1 ? `Click their name for all ${person.notes.length} comments.` : person.notes.length === 1 ? 'Click their name to read it whole.' : 'No comments.'}
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

  // One image per row. Passed stages are drawn as runs of a repeating square and counted in the image's tooltip; any
  // other stage is its own square with its name, state and time. A surface without Svg gets a glyph per stage.
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
    const passed = (stage: Stage | undefined) => stage?.status === 'success'
    const marks = stages
      .map((stage, i) => {
        if (!passed(stage)) {
          return `<use href='#s' x='${i * 12}' fill='${STAGE_COLOURS[stageTone(stage.status)]}'><title>${xml(stageLine(stage))}</title></use>`
        }
        if (passed(stages[i - 1])) {
          return ''
        }
        const run = stages.slice(i).findIndex(next => !passed(next))
        return `<rect x='${i * 12}' width='${(run === -1 ? stages.length - i : run) * 12}' height='10' fill='url(#p)'/>`
      })
      .join('')
    const count = stages.filter(passed).length
    const width = stages.length * 12
    return (
      <Svg
        isInteractive
        width={width}
        height={10}
        alt={`${stages.length} stages`}
        source={`<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='10'>${count > 0 ? `<title>${plural(count, 'stage')} passed</title>` : ''}<defs><rect id='s' width='10' height='10' rx='2'/><pattern id='p' width='12' height='10' patternUnits='userSpaceOnUse'><use href='#s' fill='${STAGE_COLOURS.success}'/></pattern></defs>${marks}</svg>`}
      />
    )
  }

  /**
   * Their avatar, else their initials on a disc, ringed in the colour of where they stand: heavy once they have a say,
   * thin while they have none, with a ✓ or ✕ badge for an approval or a request for changes. A coloured mark where the
   * surface draws no Svg. A disc costs about 340 characters (500 with a badge), a picture about 1,300.
   */
  const face = (person: Person, isFocused: boolean, picture: string | undefined) => {
    const tone = personTone(person)
    const badge = REVIEW_MARK[person.state]
    if (!Svg) {
      return <Text color={tone}>{badge?.glyph ?? (isFocused ? '◉' : '●')}</Text>
    }
    // The face is 16 pixels at the origin; the view's 3-pixel margin holds the ring and the badge.
    const inner = picture
      ? `<clipPath id='c'><circle cx='8' cy='8' r='8'/></clipPath><image href='${picture}' width='16' height='16' clip-path='url(#c)'/>`
      : discMarks(person.username, 16, person.initials)
    const ring =
      tone === 'subtle'
        ? `<circle cx='8' cy='8' r='9' fill='none' stroke='${STAGE_COLOURS[tone]}' stroke-width='1.5'/>`
        : `<circle cx='8' cy='8' r='9.5' fill='none' stroke='${STAGE_COLOURS[tone]}' stroke-width='3'/>`
    const mark = badge
      ? `<circle cx='14.75' cy='14.75' r='3.75' fill='${STAGE_COLOURS[badge.tone]}' stroke='#fff'/><path d='${badge.path}' fill='none' stroke='#fff' stroke-width='1.3' stroke-linecap='round'/>`
      : ''
    return (
      <Svg
        width={22}
        height={22}
        alt={badge ? `${person.name}, ${REVIEW_STATE[person.state]}` : person.name}
        source={`<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='-3 -3 22 22'>${inner}${ring}${mark}</svg>`}
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
    // A card opens only onto what its lines do not already show: the description, failed jobs, open threads.
    const canOpen =
      Boolean(mr.description.trim()) || mr.openThreads.length > 0 || (pipeline?.failed.length ?? 0) > 0 || (pipeline?.amber.length ?? 0) > 0
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
        <Box flexGrow={1} flexShrink={1} hover={{ scope: about }}>
          {canOpen ? (
            <Button key={scope('open')} plain label={`${isOpen ? '▾' : '▸'} ${shortTitle(mr.title)}`} onPress={() => toggle($, mr.key)} />
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
        {ticket && (ticketLink ? <Link href={ticketLink}>{`${LINK.jira} ${ticket}`}</Link> : <Text dimColor>{ticket}</Text>)}
        {!repoFilter && mr.project !== homeRepo && <Link href={mr.repo.url}>{`${LINK.repo} ${mr.repo.name}`}</Link>}
      </Box>
    )
    // What blocks the merge, worst first, in words; the hover lists every marker. GitLab's verdict, once read, is the
    // one word on whether it can merge (its rules can ignore a blocker the pane sees); the pane's other markers trail it.
    const blocker = list[0]
    const verdict = verdictOf(mr)
    const trailing = verdict ? list.filter(badge => badge.kind !== 'ready' && !verdict.covers.includes(badge.kind)) : []
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
    // Beside a face that already shows the initials, a first name reads better; two of the same name keep initials.
    // Some GitLab names are written like handles ("Mel.Northcote"), so a dot or underscore ends a first name too.
    const firstNames = mr.people.map(person => person.name.split(/[\s._]+/)[0] || person.initials)
    const callName = (person: Person, i: number) => {
      const first = firstNames[i] ?? person.initials
      return !Svg || firstNames.filter(name => name === first).length > 1 ? person.initials : first
    }
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
        {verdict ? (
          <Box flexDirection="row" gap={1} flexShrink={0} hover={{ scope: blocks }}>
            <Text bold={verdict.tone === 'success'} color={verdict.tone}>
              {verdict.words}
            </Text>
            {trailing[0] && (
              <Text dimColor>{`· ${trailingWords(mr, trailing[0])}${trailing.length > 1 ? ` +${trailing.length - 1}` : ''}`}</Text>
            )}
          </Box>
        ) : (
          blocker && (
            <Box flexShrink={0} hover={{ scope: blocks }}>
              <Text color={blocker.tone}>{`${blocker.glyph} ${blocker.words}${list.length > 1 ? ` +${list.length - 1}` : ''}`}</Text>
            </Box>
          )
        )}
        {mr.people.map((person, i) =>
          trigger(personScope(person), [
            face(person, focus?.username === person.username, withPictures && person.avatarUrl ? avatars[person.avatarUrl] : undefined),
            <Button
              key={scope(`person-${person.username}`)}
              plain
              label={`${callName(person, i)}${person.openThreads > 0 ? ` ${person.openThreads}` : ''}`}
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
            <Markdown text={bodyOf(note.body, 1_500)} />
          </Box>
        ))}
        {foot}
      </Box>
    ) : (
      <Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
        {mr.description.trim() && <Markdown text={bodyOf(mr.description, 400)} />}
        {pipeline && pipeline.failed.length + pipeline.amber.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {[...pipeline.failed.map(job => ({ job, glyph: '✗' })), ...pipeline.amber.map(job => ({ job, glyph: '⚠' }))]
              .slice(0, JOBS_SHOWN)
              .map(({ job, glyph }) => (
                <Link href={job.url}>{`${glyph} ${job.name}`}</Link>
              ))}
            {pipeline.failed.length + pipeline.amber.length > JOBS_SHOWN && (
              <Link href={pipeline.url}>{`+${pipeline.failed.length + pipeline.amber.length - JOBS_SHOWN} more`}</Link>
            )}
          </Box>
        )}
        {mr.openThreads.map(note => (
          <Box key={`t-${note.url}`} flexDirection="column">
            {byline('who', note.author, [note.where, ago(note.at, now)].filter(Boolean).join(' · '), note.url)}
            <Markdown text={bodyOf(note.body, THREAD_ROOM)} />
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
      detail: isOpen && (canOpen || focus) ? detail : null,
    }
  }

  // Rows come in order of what needs Alex. Rows he opened take the room first, with their detail; then the other rows
  // in that order, then hover cards, then avatars. Rows that do not fit at all are left out and counted.
  const built = isInbox || reading ? [] : [...session, ...mineShown, ...(showDrafts ? drafts : [])].map(row)
  let room = DRAWING_BUDGET - CHROME_SIZE
  /** Takes the room `tree` needs past what `instead` already took. */
  const fits = (tree: unknown, instead?: unknown) => {
    const size = measure(tree) - (instead === undefined ? 0 : measure(instead))
    if (size > room) {
      return false
    }
    room -= size
    return true
  }
  const opened = built.filter(part => part.detail && fits([part.line1, part.line2]))
  const withDetail = new Set(opened.filter(part => fits(part.detail)).map(part => part.key))
  const drawn = new Set([...opened, ...built.filter(part => !part.detail && fits([part.line1, part.line2]))].map(part => part.key))
  const left = built.length - drawn.size
  const withCards = new Set(built.filter(part => drawn.has(part.key) && fits([part.under1, part.under2])).map(part => part.key))
  const withFaces = new Set(built.filter(part => drawn.has(part.key) && part.faces && fits(part.faces, part.line2)).map(part => part.key))
  const draw = (mr: MrCard) => {
    const part = built.find(one => one.key === mr.key)
    if (!part || !drawn.has(part.key)) {
      return null
    }
    const hasCards = withCards.has(part.key)
    // The colour is the review, in the stage squares' own colours, brighter than the theme's tones; the heavier line
    // is an MR that needs you.
    return (
      <Box
        key={cardKey(part.key)}
        flexDirection="column"
        borderStyle={rank(mr) === 0 ? 'bold' : 'round'}
        borderColor={STAGE_COLOURS[reviewTone(mr)]}
        hover={part.canOpen ? { borderColor: 'claude' } : undefined}
        paddingX={1}
      >
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
        ? `${updatedLine(ago(new Date(poll.fetchedAt).toISOString(), now))}${poll.kept ? `; ${plural(poll.kept, 'MR')} kept from the last read` : ''}`
        : 'reading GitLab…'

  // An MR counts as news once, whichever rules list it, as the inbox itself counts it.
  const { inbox: inboxState } = await inboxView($)
  const news = new Set(inboxState.sections.flatMap(section => section.items.filter(item => item.unseen > 0).map(item => item.key))).size
  const openCount = rows.filter(row => !row.isDraft || pinnedKeys.has(row.key)).length
  // A see-through tint where the surface draws one; the terminal gets the name in colour alone.
  const current = VIEWS[isInbox ? 'inbox' : 'mine']
  const band = (
    <Box flexDirection="column" paddingX={1} paddingY={1} backgroundColor={e.surface === 'terminal' ? undefined : `${current.colour}1f`}>
      <Text size="heading" weight="semibold" color={current.colour}>
        {current.title}
      </Text>
      <Text dimColor size="footnote">
        {current.about}
      </Text>
    </Box>
  )
  const mineTab = [
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
    </Box>,
    ...(session.length > 0 ? [<Text bold>This session</Text>, ...session.map(draw)] : []),
    <Text bold>{`Mine · ${mine.length}`}</Text>,
    ...(mine.length === 0 ? [<Text dimColor>Nothing open here.</Text>] : []),
    ...mineShown.map(draw),
    ...(mine.length > MINE_SHOWN
      ? [<Button key="more" plain label={showMore ? '▾ Show fewer' : `▸ ${mine.length - MINE_SHOWN} more`} onPress={() => toggle($, 'more')} />]
      : []),
    ...(drafts.length > 0
      ? [<Button key="drafts" plain label={`${showDrafts ? '▾' : '▸'} Drafts · ${drafts.length}`} onPress={() => toggle($, 'drafts')} />]
      : []),
    ...(showDrafts ? drafts.map(draw) : []),
    ...(left > 0 ? [<Text dimColor>{`${plural(left, 'more MR')} left out to stay within what the app draws; pick a repo above to see them.`}</Text>] : []),
  ]

  // An MR read whole is a page over its tab, a way back at each end, so a long one needs no scrolling back up.
  const back = (key: string) => <Button key={key} plain label={isInbox ? '‹ Inbox' : '‹ Mine'} onPress={() => leaveReading($)} />
  const body = reading
    ? [back('back-top'), ...drawReading($, e, reading, folds, now), back('back-bottom')]
    : [
        <Box flexDirection="row" columnGap={1}>
          <Button key="tab-mine" label={`Mine · ${openCount}`} variant={isInbox ? 'secondary' : 'primary'} onPress={() => openTab($, 'mine')} />
          <Button
            key="tab-inbox"
            label={news > 0 ? `Inbox · ${news} new` : 'Inbox'}
            variant={isInbox ? 'primary' : 'secondary'}
            onPress={() => openTab($, 'inbox')}
          />
        </Box>,
        band,
        ...(isInbox ? [await drawInbox($, e)] : mineTab),
      ]

  return (
    <Box flexDirection="column" gap={1}>
      {body}
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
