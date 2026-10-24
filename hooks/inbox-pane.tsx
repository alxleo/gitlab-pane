import type { EngineInterface, RenderInput } from 'claude-code'

import { ago, shortTitle } from './ci'
import { inboxView, markSeen, syncInbox, toggleRule } from './inbox'

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

  const itemLine = (item: InboxItem) => {
    const what = item.activity.map(one => `@${one.actor} ${KIND_WORD[one.kind] ?? one.kind} ${ago(one.at, now)}`)
    const who = `@${item.author}${item.isDraft ? ' · draft' : ''}${item.state === 'opened' ? '' : ` · ${item.state}`}`
    return (
      <Box key={`ib-${hashOf(item.key)}`} flexDirection="column" paddingLeft={2}>
        <Box flexDirection="row" gap={1}>
          <Link href={item.url}>{`🔀 ${item.ref}`}</Link>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">{shortTitle(item.title)}</Text>
          </Box>
          {item.unseen > 0 && <Text color="warning">{`${item.unseen} new`}</Text>}
          <Button
            key={`inbox-seen-${hashOf(item.key)}`}
            plain
            label="✓"
            onPress={() => markSeen($, { key: item.key }).catch(() => undefined)}
          />
        </Box>
        <Box paddingLeft={3}>
          <Text dimColor wrap="truncate-end">
            {[who, ...what].join(' · ')}
          </Text>
        </Box>
      </Box>
    )
  }

  const shown = inbox.sections.filter(section => section.items.length > 0)
  const quiet = inbox.sections.filter(section => section.items.length === 0)
  const header = (section: InboxSection) => {
    const isOpen = open.includes(section.rule)
    const fresh = section.items.reduce((sum, item) => sum + item.unseen, 0)
    return (
      <Button
        key={`inbox-rule-${section.rule}`}
        plain
        label={`${isOpen ? '▾' : '▸'} ${section.title} · ${section.items.length}${fresh > 0 ? ` · ${fresh} new` : ''}`}
        onPress={() => toggleRule($, section.rule)}
      />
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
      const line = itemLine(item)
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
      <Box key={`inbox-foot-${section.rule}`} flexDirection="row" gap={2} paddingLeft={2}>
        {left > 0 && <Text dimColor>{`+${left} more · /mrs --rule ${section.rule} to discuss them`}</Text>}
        <Button
          key={`inbox-seen-rule-${section.rule}`}
          plain
          label="✓ mark all seen"
          onPress={() => markSeen($, { rule: section.rule }).catch(() => undefined)}
        />
      </Box>,
    ]
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        <Text bold>Inbox</Text>
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
          {`Nothing in: ${quiet.map(section => (section.note ? `${section.title} (${section.note})` : section.title)).join(', ')}`}
        </Text>
      )}
    </Box>
  )
}
