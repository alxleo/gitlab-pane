import type { EngineInterface, RenderInput } from 'claude-code'

import { ago, shortTitle } from './ci'
import { discussRule, inboxView, markSeen, syncInbox, toggleRule } from './inbox'

import type { InboxItem, InboxSection } from '../types'

const KIND_WORD: Record<string, string> = {
  comment: 'commented',
  review: 'reviewed',
  approved: 'approved',
  unapproved: 'withdrew approval',
  changes_requested: 'requested changes',
  merged: 'merged',
  opened: 'opened',
  pushed: 'pushed',
  review_requested: 'asked for a review',
}

/** The order a card counts activity in: what blocks or clears a merge first. */
const COUNTED = ['changes_requested', 'unapproved', 'approved', 'review', 'comment', 'review_requested', 'pushed', 'opened', 'merged']

/** What the inbox may take of the pane's drawing; past it, an open rule's rows are counted, not drawn. */
const INBOX_BUDGET = 16_000
const ITEMS_SHOWN = 8

const measure = (tree: unknown): number => {
  try {
    return JSON.stringify(tree)?.length ?? 0
  } catch {
    return INBOX_BUDGET
  }
}

const hashOf = (text: string): string =>
  [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7).toString(36)

/** The inbox mr-inbox's rules give: each rule a fold, each MR a line saying what happened, ✓ to mark it seen. */
export async function drawInbox($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
  const { inbox, open, now } = await inboxView($)
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

  /** A card per MR, bordered while something on it is new: title first, then the ref and what the rule counted. */
  const itemCard = (item: InboxItem) => {
    const bang = item.ref.lastIndexOf('!')
    const counted = COUNTED.filter(kind => item.counts[kind]).map(kind => `${item.counts[kind]} ${KIND_WORD[kind]}`)
    const newest = item.activity[0]?.at
    const about = [
      bang > 0 ? item.ref.slice(0, bang) : '',
      item.author,
      item.isDraft ? 'draft' : '',
      item.state === 'opened' ? '' : item.state,
      ...counted,
      newest ? ago(newest, now) : '',
    ]
    return (
      <Box
        key={`ib-${hashOf(item.key)}`}
        flexDirection="column"
        borderStyle="round"
        borderColor={item.unseen > 0 ? 'warning' : 'subtle'}
        paddingX={1}
      >
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text weight="semibold" wrap="truncate-end">
              {shortTitle(item.title)}
            </Text>
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
  const header = (section: InboxSection) => {
    const isOpen = open.includes(section.rule)
    // MRs with news, not events: an MR nobody has marked seen brings a week of comments, which would swamp the count.
    const fresh = section.items.filter(item => item.unseen > 0).length
    return (
      <Button key={`inbox-rule-${section.rule}`} plain onPress={() => toggleRule($, section.rule)}>
        <Text weight="semibold">{`${isOpen ? '▾' : '▸'} ${section.title}`}</Text>
        <Text dimColor>{` · ${section.items.length}${fresh > 0 ? ` · ${fresh} new` : ''}`}</Text>
      </Button>
    )
  }

  // Headers always draw; open rules' rows take what is left of the budget, in rule order.
  let room = INBOX_BUDGET - measure(shown.map(header)) - 1_500
  const body = (section: InboxSection) => {
    if (!open.includes(section.rule)) {
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
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        <Text bold>{news > 0 ? `Inbox · ${news} new` : 'Inbox'}</Text>
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
      {shown.flatMap(section => [header(section), ...body(section)])}
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
