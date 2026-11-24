import type { EngineInterface, RenderInput } from 'claude-code'

import { discSource } from './avatar'
import { isFilled } from './decode'
import { ago, shortTitle } from './format'
import { CONTROL, measure, opens } from './drawing'
import { hinted, hintLine, homed } from './hint'
import { kitOf } from './kit'
import type { Kit } from './kit'
import { firstName, initials, shortHash } from './identity'
import { reported } from './failures'
import { discussRule, inboxView, markSeen, toggleCard, toggleHere, toggleRule } from './inbox'
import { ITEMS_SHOWN, cardButtons, footerButtons } from './inbox-ring'
import { inboxDrawn } from './in-flight'
import { seenOne } from './panes'
import { ownedSections } from './inbox-rules'

import type { InboxActivity, InboxItem, InboxKind, InboxSection } from '../types'

/** How each kind of activity reads, in the order a card counts them: what blocks or clears a merge first. */
/** An event with no one to name (a pipeline failing, a merge that cannot happen) reads without an actor. */
/** One that `blocks` a merge is counted in words on every surface; the others are their mark and count under a pointer. */
export const VERB: Record<InboxKind, { glyph: string; tone?: string; word: string; isImpersonal?: boolean; blocks?: true }> = {
  changes_requested: { glyph: '✗', tone: 'error', word: 'requested changes', blocks: true },
  unapproved: { glyph: '↺', tone: 'warning', word: 'withdrew approval' },
  approved: { glyph: '✓', tone: 'success', word: 'approved' },
  review: { glyph: '●', tone: 'suggestion', word: 'reviewed' },
  comment: { glyph: '💬', word: 'commented' },
  mentioned: { glyph: '@', word: 'mentioned you' },
  review_requested: { glyph: '?', word: 'asked for a review' },
  pushed: { glyph: '↑', word: 'pushed' },
  merged: { glyph: '◆', tone: 'merged', word: 'merged' },
  build_failed: { glyph: '✗', tone: 'error', word: 'pipeline failed', isImpersonal: true, blocks: true },
  unmergeable: { glyph: '⚠', tone: 'warning', word: "can't merge", isImpersonal: true, blocks: true },
}

const KINDS = Object.keys(VERB).filter((kind): kind is InboxKind => kind in VERB)

/**
 * What the inbox may take of the pane's drawing, now that it has its own tab and shares the drawing only with the
 * tabs and the footer; past it, an open rule's cards are counted, not drawn.
 */
const INBOX_BUDGET = 70_000

/** The inbox the built-in rules give: a tab per rule, a card per MR saying who did what, ✓ to mark it seen. */
export async function drawInbox($: EngineInterface, e: RenderInput<'Pane'>) {
  const { inbox, isHere, sections: ruled, problem, open, cards, now } = await inboxView($)
  const kit = kitOf($, e, now)
  const { Box, Text, Button, Link, Svg } = kit
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
  const avatar = (home: Kit, username: string, key: string) =>
    Svg !== undefined ? (
      <Box flexShrink={0}>
        {hinted(
          home,
          `hint-who-${key}`,
          names.get(username) ?? username,
          <Svg width={16} height={16} alt={username} source={discSource(username, 16, initials(names.get(username) ?? '', username))} />
        )}
      </Box>
    ) : null

  /** Who did what, coloured by what it does to the merge; the words they wrote follow, when there are any. */
  const event = (home: Kit, mr: string, one: InboxActivity, at: number, isWhole: boolean) => {
    const verb = VERB[one.kind]
    const when = ago(one.at, now)
    const said = one.excerpt !== '' ? `“${one.excerpt}”` : ''
    // Its MR and place in its list: two events of one person, kind and second are still two, and each region takes its own key.
    const tag = shortHash(`${mr}#${at}`)
    return (
      <Box key={`ev-${tag}`} flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {verb.isImpersonal !== true && avatar(home, one.actor, tag)}
          <Box flexShrink={0}>
            <Text color={verb.tone}>
              {verb.isImpersonal === true ? `${verb.glyph} ${verb.word}` : `${verb.glyph} ${firstName(names.get(one.actor) ?? '', one.actor)} ${verb.word}`}
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            {!isWhole && said !== '' && (
              <Text dimColor italic wrap="truncate-end">
                {said}
              </Text>
            )}
          </Box>
          <Box flexShrink={0}>{isFilled(one.url) ? hinted(home, `hint-at-${tag}`, opens('comment'), <Link href={one.url}>{when}</Link>) : <Text dimColor>{when}</Text>}</Box>
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
   * A card per MR, saying `N new` while something on it is new: its title, its ref with what the rule counted, then the
   * newest event. A press on the title opens every event kept, with what each said.
   */
  const itemCard = (item: InboxItem) => {
    const bang = item.ref.lastIndexOf('!')
    const counts = KINDS.flatMap(kind => {
      const count = item.counts[kind] ?? 0
      return count > 0 ? [{ kind, count: `${count}${item.isCapped ? '+' : ''}` }] : []
    })
    // Under a pointer each count is its event's mark, which says the event's words once the pointer rests; elsewhere the words
    // follow the facts. What blocks a merge keeps its words everywhere: words beat icons for that.
    const marked = kit.showsHints ? counts.filter(({ kind }) => VERB[kind].blocks !== true) : []
    const counted = counts.filter(each => !marked.includes(each)).map(({ kind, count }) => `${count} ${VERB[kind].word}`)
    const about = [bang > 0 ? item.ref.slice(0, bang) : '', item.isMine ? '' : item.author, item.isDraft ? 'draft' : '', item.state === 'opened' ? '' : item.state, ...counted]
    const canOpen = item.activity.length > 0
    const isOpen = canOpen && cards.includes(item.key)
    const buttons = cardButtons(item.key)
    const home = homed(kit, `ib-${shortHash(item.key)}`)
    return (
      <Box key={`ib-${shortHash(item.key)}`} flexDirection="column" paddingX={1} marginBottom={1}>
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            {/* A link-blue title read as a way out to GitLab; the ref on the next line is that way. */}
            {canOpen ? (
              <Button key={buttons.open} plain label={`${isOpen ? '▾' : '▸'} ${shortTitle(item.title)}`} onPress={() => toggleCard($, item.key)} />
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
            {hinted(
              home,
              `hint-seen-${shortHash(item.key)}`,
              CONTROL.seen.hint,
              <Button key={buttons.seen} plain label={CONTROL.seen.mark} onPress={() => seenOne($, item.key).catch(reported($, 'inbox'))} />
            )}
          </Box>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Box flexShrink={0}>{hinted(home, `hint-mr-${shortHash(item.key)}`, opens('mr'), <Link href={item.url}>{item.ref.slice(bang)}</Link>)}</Box>
          {marked.length > 0 && (
            <Box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={1}>
              {marked.map(({ kind, count }) =>
                hinted(
                  home,
                  `hint-${kind}-${shortHash(item.key)}`,
                  VERB[kind].word,
                  <Text color={VERB[kind].tone} dimColor={VERB[kind].tone === undefined} size="footnote">{`${VERB[kind].glyph}${count}`}</Text>
                )
              )}
            </Box>
          )}
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor size="footnote" wrap="truncate-end">
              {about.filter(Boolean).join(' · ')}
            </Text>
          </Box>
        </Box>
        {isOpen ? item.activity.map((one, at) => event(home, item.key, one, at, true)) : item.activity[0] !== undefined && event(home, item.key, item.activity[0], 0, false)}
        {isOpen && <Button key={buttons.less} plain label="▴ less" onPress={() => toggleCard($, item.key)} />}
        {hintLine(home)}
      </Box>
    )
  }

  const sections = ownedSections(ruled)
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
    const keys: string[] = []
    for (const item of section.items.slice(0, ITEMS_SHOWN)) {
      const line = itemCard(item)
      const size = measure(line, INBOX_BUDGET)
      if (size > room) {
        break
      }
      room -= size
      lines.push(line)
      keys.push(item.key)
    }
    // The focus ring's arrows walk only these.
    inboxDrawn(section.rule, keys)
    const left = section.items.length - lines.length
    const footer = footerButtons(section.rule)
    return [
      ...lines,
      <Box key={`inbox-foot-${section.rule}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
        {left > 0 && <Text dimColor>{`+${left} more`}</Text>}
        <Button key={footer.discuss} variant="secondary" label="discuss in chat" onPress={() => discussRule($, section.rule).catch(reported($, 'inbox'))} />
        {/* s presses it while the pane holds the keyboard; the terminal, where that is proven, says so. */}
        <Button
          key={footer.seen}
          variant="secondary"
          hotkey="s"
          label={e.surface === 'terminal' ? '✓ mark all seen (s)' : '✓ mark all seen'}
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
