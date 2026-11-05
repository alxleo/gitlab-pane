import type { EngineInterface, RenderInput } from 'claude-code'

import { discSource } from './avatar'
import { isFilled } from './decode'
import { ago, shortTitle } from './format'
import { measure } from './drawing'
import { firstName, initials, shortHash } from './identity'
import { reported } from './failures'
import { discussRule, inboxView, markSeen, syncInbox, toggleCard, toggleHere, toggleRule } from './inbox'

import type { InboxActivity, InboxItem, InboxKind, InboxSection } from '../types'

/** How each kind of activity reads, in the order a card counts them: what blocks or clears a merge first. */
/** An event with no one to name (a pipeline failing, a merge that cannot happen) reads without an actor. */
export const VERB: Record<InboxKind, { glyph: string; tone?: string; word: string; isImpersonal?: boolean }> = {
  changes_requested: { glyph: '✗', tone: 'error', word: 'requested changes' },
  unapproved: { glyph: '↺', tone: 'warning', word: 'withdrew approval' },
  approved: { glyph: '✓', tone: 'success', word: 'approved' },
  review: { glyph: '●', tone: 'suggestion', word: 'reviewed' },
  comment: { glyph: '💬', word: 'commented' },
  mentioned: { glyph: '@', word: 'mentioned you' },
  review_requested: { glyph: '?', word: 'asked for a review' },
  pushed: { glyph: '↑', word: 'pushed' },
  merged: { glyph: '◆', tone: 'merged', word: 'merged' },
  build_failed: { glyph: '✗', tone: 'error', word: 'pipeline failed', isImpersonal: true },
  unmergeable: { glyph: '⚠', tone: 'warning', word: "can't merge", isImpersonal: true },
}

const KINDS = Object.keys(VERB).filter((kind): kind is InboxKind => kind in VERB)

/**
 * What the inbox may take of the pane's drawing, now that it has its own tab and shares the drawing only with the
 * tabs and the footer; past it, an open rule's cards are counted, not drawn.
 */
const INBOX_BUDGET = 70_000
const ITEMS_SHOWN = 30

/** The inbox the built-in rules give: a tab per rule, a card per MR saying who did what, ✓ to mark it seen. */
export async function drawInbox($: EngineInterface, e: RenderInput<'Pane'>) {
  const elements = $.ui.resolve(e)
  const { Box, Text, Button, Link } = elements
  // The terminal's table still answers `Svg`, drawn as an empty box, so the surface decides.
  const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
  const { inbox, isHere, sections: ruled, problem, open, cards, now } = await inboxView($)
  const since = (iso: string) => {
    const age = ago(iso, now)
    return age === 'now' ? 'just now' : `${age} ago`
  }
  const status =
    problem !== null
      ? `sync failed: ${problem}`
      : inbox.snapshot.at > 0
        ? `synced ${since(new Date(inbox.snapshot.at).toISOString())}`
        : inbox.readAt === null || inbox.isSyncing
          ? 'reading GitLab…'
          : 'not synced yet'

  // GitLab gives a display name only for an MR's author, so an actor is known by name where they wrote an MR here, and
  // otherwise by username alone: `ixm5302` is IX until some card names them.
  const names = new Map(ruled.flatMap(section => section.items).map(item => [item.author, item.authorName]))

  /** An initials disc, coloured by username; where the surface draws no Svg, nothing. */
  const avatar = (username: string) =>
    Svg !== undefined ? (
      <Box flexShrink={0}>
        <Svg width={16} height={16} alt={username} source={discSource(username, 16, initials(names.get(username) ?? '', username))} />
      </Box>
    ) : null

  /** Who did what, coloured by what it does to the merge; the words they wrote follow, when there are any. */
  const event = (one: InboxActivity, isWhole: boolean) => {
    const verb = VERB[one.kind]
    const when = ago(one.at, now)
    const said = one.excerpt !== '' ? `“${one.excerpt}”` : ''
    return (
      <Box key={`ev-${shortHash(`${one.actor}${one.at}${one.kind}`)}`} flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {verb.isImpersonal !== true && avatar(one.actor)}
          <Box flexShrink={0}>
            <Text color={verb.tone}>{verb.isImpersonal === true ? `${verb.glyph} ${verb.word}` : `${verb.glyph} ${firstName(names.get(one.actor) ?? '', one.actor)} ${verb.word}`}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            {!isWhole && said !== '' && (
              <Text dimColor italic wrap="truncate-end">
                {said}
              </Text>
            )}
          </Box>
          <Box flexShrink={0}>
            {isFilled(one.url) ? <Link href={one.url}>{when}</Link> : <Text dimColor>{when}</Text>}
          </Box>
        </Box>
        {isWhole && said !== '' && (
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
    const counted = KINDS.filter(kind => (item.counts[kind] ?? 0) > 0).map(kind => `${item.counts[kind]}${item.isCapped ? '+' : ''} ${VERB[kind].word}`)
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
        key={`ib-${shortHash(item.key)}`}
        flexDirection="column"
        borderStyle="round"
        borderColor={item.unseen > 0 ? 'warning' : 'subtle'}
        hover={canOpen ? { borderColor: 'claude' } : undefined}
        paddingX={1}
      >
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            {/* A link-blue title read as a way out to GitLab; the ref on the next line is that way. */}
            {canOpen ? (
              <Button
                key={`inbox-open-${shortHash(item.key)}`}
                plain
                label={`${isOpen ? '▾' : '▸'} ${shortTitle(item.title)}`}
                onPress={() => toggleCard($, item.key)}
              />
            ) : (
              <Text weight="semibold" wrap="truncate-end">
                {shortTitle(item.title)}
              </Text>
            )}
          </Box>
          {item.unseen > 0 && (
            <Box flexShrink={0}>
              <Text color="warning">{`${item.unseen}${item.isCapped ? '+' : ''} new`}</Text>
            </Box>
          )}
          <Box flexShrink={0}>
            <Button
              key={`inbox-seen-${shortHash(item.key)}`}
              plain
              label="✓"
              onPress={() => markSeen($, { key: item.key }).catch(reported($, 'inbox'))}
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
          : item.activity[0] !== undefined && event(item.activity[0], false)}
        {isOpen && (
          <Button key={`inbox-less-${shortHash(item.key)}`} plain label="▴ less" onPress={() => toggleCard($, item.key)} />
        )}
      </Box>
    )
  }

  // Each MR shows once, under the first rule that has it.
  const firstRule = new Map<string, string>()
  for (const section of ruled) {
    for (const item of section.items) {
      if (!firstRule.has(item.key)) {
        firstRule.set(item.key, section.rule)
      }
    }
  }
  const sections = ruled.map(section => ({
    ...section,
    items: section.items.filter(item => firstRule.get(item.key) === section.rule),
    isAllAbove: section.items.length > 0 && section.items.every(item => firstRule.get(item.key) !== section.rule),
  }))
  const shown = sections.filter(section => section.items.length > 0)
  const quiet = sections.filter(section => section.items.length === 0)
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
  let room = INBOX_BUDGET - measure(shown.map(tab), INBOX_BUDGET) - 1_500
  const body = (section: InboxSection) => {
    if (open[0] !== section.rule) {
      return []
    }
    const lines = []
    for (const item of section.items.slice(0, ITEMS_SHOWN)) {
      const line = itemCard(item)
      const size = measure(line, INBOX_BUDGET)
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
          onPress={() => discussRule($, section.rule).catch(reported($, 'inbox'))}
        />
        <Button
          key={`inbox-seen-rule-${section.rule}`}
          variant="secondary"
          label="✓ mark all seen"
          onPress={() => markSeen($, { rule: section.rule }).catch(reported($, 'inbox'))}
        />
      </Box>,
    ]
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2}>
        <Text color={problem !== null ? 'warning' : undefined} dimColor={problem === null} size="footnote">
          {status}
        </Text>
        <Button key="inbox-here" plain label={isHere ? '● here' : '○ here'} onPress={() => toggleHere($)} />
        <Button
          key="inbox-sync"
          plain
          label={inbox.isSyncing ? 'syncing…' : 'sync'}
          onPress={() => syncInbox($).catch(reported($, 'inbox'))}
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
            .map(section => (isFilled(section.note) ? `${section.title} (${section.note})` : section.isAllAbove ? `${section.title} (all above)` : section.title))
            .join(', ')}`}
        </Text>
      )}
    </Box>
  )
}
