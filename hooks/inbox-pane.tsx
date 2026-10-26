import type { EngineInterface, RenderInput } from 'claude-code'

import { ago, markdownText, shortTitle } from './ci'
import { discussRule, inboxView, markSeen, syncInbox, toggleCard, toggleRule } from './inbox'

import type { InboxActivity, InboxItem, InboxSection } from '../types'

/** How each kind of activity reads, in the order a card counts them: what blocks or clears a merge first. */
const VERB: Record<string, { glyph: string; tone?: string; word: string }> = {
  changes_requested: { glyph: '✗', tone: 'error', word: 'requested changes' },
  unapproved: { glyph: '↺', tone: 'warning', word: 'withdrew approval' },
  approved: { glyph: '✓', tone: 'success', word: 'approved' },
  review: { glyph: '●', tone: 'suggestion', word: 'reviewed' },
  comment: { glyph: '💬', word: 'commented' },
  review_requested: { glyph: '?', word: 'asked for a review' },
  pushed: { glyph: '↑', word: 'pushed' },
  opened: { glyph: '+', word: 'opened' },
  merged: { glyph: '◆', tone: 'merged', word: 'merged' },
}

/** Fills for initials avatars, picked by name so a person keeps one colour in every card. */
const AVATAR_FILLS = ['#5B8DEF', '#E5734A', '#3FA27B', '#B062D8', '#C9971C', '#E0567A', '#3A9FBF', '#7A8899']

/** What the inbox may take of the pane's drawing; past it, an open rule's rows are counted, not drawn. */
const INBOX_BUDGET = 20_000
const ITEMS_SHOWN = 8

const measure = (tree: unknown): number => {
  try {
    return JSON.stringify(tree)?.length ?? 0
  } catch {
    return INBOX_BUDGET
  }
}

const hashNumber = (text: string): number =>
  [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7)
const hashOf = (text: string): string => hashNumber(text).toString(36)

/** `Tessa.Ravensworth` is Tessa; a handle with no separator stays whole. */
const firstName = (username: string): string => username.split(/[._]/)[0] || username

const initialsOf = (username: string): string => {
  const parts = username.split(/[._\-\s]+/).filter(Boolean)
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : username.slice(0, 2)
  return letters.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/** The inbox mr-inbox's rules give: a tab per rule, a card per MR saying who did what, ✓ to mark it seen. */
export async function drawInbox($: EngineInterface, e: RenderInput<'Pane'>) {
  const elements = $.ui.resolve(e)
  const { Box, Text, Button, Link, Markdown } = elements
  // The terminal's table still answers `Svg`, drawn as an empty box, so the surface decides.
  const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
  const { inbox, open, cards, now } = await inboxView($)
  const since = (iso: string) => {
    const age = ago(iso, now)
    return age === 'now' ? 'just now' : `${age} ago`
  }
  const problem = inbox.error ?? (inbox.syncError ? `sync failed: ${inbox.syncError}` : null)
  const status =
    problem ??
    (inbox.syncedAt
      ? `synced ${since(inbox.syncedAt)}`
      : inbox.readAt === null || inbox.isSyncing
        ? 'reading GitLab…'
        : 'not synced yet')

  /** An initials disc, coloured by name; where the surface draws no Svg, nothing. */
  const avatar = (username: string) =>
    Svg ? (
      <Box flexShrink={0}>
        <Svg
          width={16}
          height={16}
          alt={username}
          source={`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='8' cy='8' r='8' fill='${AVATAR_FILLS[hashNumber(username) % AVATAR_FILLS.length]}'/><text x='8' y='10.6' font-family='-apple-system,Helvetica,sans-serif' font-size='7' font-weight='700' text-anchor='middle' fill='#fff'>${initialsOf(username)}</text></svg>`}
        />
      </Box>
    ) : null

  /** Who did what, coloured by what it does to the merge; the words they wrote follow, when there are any. */
  const event = (one: InboxActivity, isWhole: boolean) => {
    const verb = VERB[one.kind] ?? { glyph: '·', word: one.kind }
    const when = ago(one.at, now)
    const said = one.excerpt ? `“${one.excerpt}”` : ''
    return (
      <Box key={`ev-${hashOf(`${one.actor}${one.at}${one.kind}`)}`} flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {avatar(one.actor)}
          <Box flexShrink={0}>
            <Text color={verb.tone}>{`${verb.glyph} ${firstName(one.actor)} ${verb.word}`}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            {!isWhole && said && (
              <Text dimColor italic wrap="truncate-end">
                {said}
              </Text>
            )}
          </Box>
          <Box flexShrink={0}>
            {one.url ? <Link href={one.url}>{when}</Link> : <Text dimColor>{when}</Text>}
          </Box>
        </Box>
        {isWhole && said && (
          <Box paddingLeft={3}>
            <Text dimColor italic>
              {said}
            </Text>
          </Box>
        )}
      </Box>
    )
  }

  /**
   * A card per MR, bordered while something on it is new: its title, its ref with what the rule counted, then the
   * newest event. A press on the title opens every event kept, with what each said.
   */
  const itemCard = (item: InboxItem) => {
    const bang = item.ref.lastIndexOf('!')
    const counted = Object.keys(VERB)
      .filter(kind => item.counts[kind])
      .map(kind => `${item.counts[kind]} ${VERB[kind]?.word}`)
    const about = [
      bang > 0 ? item.ref.slice(0, bang) : '',
      item.isMine ? '' : item.author,
      item.isDraft ? 'draft' : '',
      item.state === 'opened' ? '' : item.state,
      ...counted,
    ]
    const canOpen = item.activity.length > 0
    const isOpen = canOpen && cards.includes(item.key)
    return (
      <Box
        key={`ib-${hashOf(item.key)}`}
        flexDirection="column"
        borderStyle="round"
        borderColor={item.unseen > 0 ? 'warning' : 'subtle'}
        hover={canOpen ? { borderColor: 'claude' } : undefined}
        paddingX={1}
      >
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            {canOpen ? (
              <Markdown
                key={`inbox-open-${hashOf(item.key)}`}
                text={`[**${markdownText(shortTitle(item.title))}**](${item.url})`}
                pressableLinks={[item.url]}
                onLinkPress={() => toggleCard($, item.key)}
              />
            ) : (
              <Text weight="semibold" wrap="truncate-end">
                {shortTitle(item.title)}
              </Text>
            )}
          </Box>
          {item.unseen > 0 && (
            <Box flexShrink={0}>
              <Text color="warning">{`${item.unseen} new`}</Text>
            </Box>
          )}
          <Box flexShrink={0}>
            <Button
              key={`inbox-seen-${hashOf(item.key)}`}
              plain
              label="✓"
              onPress={() => markSeen($, { key: item.key }).catch(() => undefined)}
            />
          </Box>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Box flexShrink={0}>
            <Link href={item.url}>{item.ref.slice(bang)}</Link>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor size="footnote" wrap="truncate-end">
              {about.filter(Boolean).join(' · ')}
            </Text>
          </Box>
        </Box>
        {isOpen
          ? item.activity.map(one => event(one, true))
          : item.activity[0] && event(item.activity[0], false)}
      </Box>
    )
  }

  // Each MR shows once, under the first rule that has it.
  const firstRule = new Map<string, string>()
  for (const section of inbox.sections) {
    for (const item of section.items) {
      if (!firstRule.has(item.key)) {
        firstRule.set(item.key, section.rule)
      }
    }
  }
  const sections = inbox.sections.map(section => ({
    ...section,
    items: section.items.filter(item => firstRule.get(item.key) === section.rule),
    isAllAbove: section.items.length > 0 && section.items.every(item => firstRule.get(item.key) !== section.rule),
  }))
  const shown = sections.filter(section => section.items.length > 0)
  const quiet = sections.filter(section => section.items.length === 0)
  const news = shown.reduce((sum, section) => sum + section.items.filter(item => item.unseen > 0).length, 0)
  /** A tab per rule, as the repo filter draws its chips; the open one is filled. */
  const tab = (section: InboxSection) => {
    // MRs with news, not events: an MR nobody has marked seen brings a week of comments, which would swamp the count.
    const fresh = section.items.filter(item => item.unseen > 0).length
    return (
      <Button
        key={`inbox-rule-${section.rule}`}
        variant={open[0] === section.rule ? 'primary' : 'secondary'}
        label={`${section.title} · ${fresh > 0 ? `${fresh} new` : section.items.length}`}
        onPress={() => toggleRule($, section.rule)}
      />
    )
  }

  // The tabs always draw; the open rule's cards take what is left of the budget.
  let room = INBOX_BUDGET - measure(shown.map(tab)) - 1_500
  const body = (section: InboxSection) => {
    if (open[0] !== section.rule) {
      return []
    }
    const lines = []
    for (const item of section.items.slice(0, ITEMS_SHOWN)) {
      const line = itemCard(item)
      const size = measure(line)
      if (size > room) {
        break
      }
      room -= size
      lines.push(line)
    }
    const left = section.items.length - lines.length
    return [
      ...lines,
      <Box key={`inbox-foot-${section.rule}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
        {left > 0 && <Text dimColor>{`+${left} more`}</Text>}
        <Button
          key={`inbox-discuss-${section.rule}`}
          variant="secondary"
          label="discuss in chat"
          onPress={() => discussRule($, section.rule).catch(() => undefined)}
        />
        <Button
          key={`inbox-seen-rule-${section.rule}`}
          variant="secondary"
          label="✓ mark all seen"
          onPress={() => markSeen($, { rule: section.rule }).catch(() => undefined)}
        />
      </Box>,
    ]
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2}>
        <Text bold>Inbox</Text>
        {news > 0 && <Text color="warning">{`${news} new`}</Text>}
        <Text color={problem ? 'warning' : undefined} dimColor={!problem} size="footnote">
          {status}
        </Text>
        <Button
          key="inbox-sync"
          plain
          label={inbox.isSyncing ? 'syncing…' : 'sync'}
          onPress={() => syncInbox($).catch(() => undefined)}
        />
      </Box>
      {shown.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {shown.map(tab)}
        </Box>
      )}
      {shown.flatMap(body)}
      {quiet.length > 0 && (
        <Text dimColor wrap="truncate-end">
          {`Nothing else in: ${quiet
            .map(section => (section.note ? `${section.title} (${section.note})` : section.isAllAbove ? `${section.title} (all above)` : section.title))
            .join(', ')}`}
        </Text>
      )}
    </Box>
  )
}
