import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import { CHROME_SIZE, DRAWING_BUDGET, LINK, measure, opens } from './drawing'
import { ago, plural } from './format'
import { hinted, hintLine, hintRoom, homed } from './hint'
import type { HomedKit } from './hint'
import { shortHash } from './identity'
import { kitOf } from './kit'
import { cutToFit, EMPTY_MARKDOWN, partsOf } from './markdown'
import { showWhole, toggleFold } from './choices'
import { personPage } from './page-lines'
import { closeReply, confirmReply, editReply, openReply, postReply, typeReply } from './replies'
import { replyId } from './reply-model'

import type { MarkdownText, Part } from './markdown'
import type { PageHead } from './page-lines'
import type { MrCard, Note, ReplyBox, Write } from '../types'

/** Room kept for the link that says the rest is on GitLab. */
const CUT_NOTE_SIZE = 300

/**
 * How a page is drawn: `folds` are the `<details>` drawn the other way from how GitLab first shows them, `focus` the
 * person whose comments alone it shows (empty for the whole MR), `head` what it says of the ticket and the merge, `reply`
 * the reply box open under one of its threads, `writes` the ledger that says how far each reply got.
 */
export type PageView = { folds: string[]; focus: string; head: PageHead; now: number; reply: ReplyBox; writes: Readonly<Record<string, Write>> }

/**
 * One MR whole, as a page of its own drawn alone: the jobs, threads and bot comments that need acting on take the room first,
 * then the description what is left, cut where it runs out. Opened on one person, it shows what they wrote and leads on to
 * the whole MR.
 */
export function drawReading($: EngineInterface, e: RenderInput<'Pane'>, mr: MrCard, { folds, focus, head: about, now, reply, writes }: PageView) {
  const { Box, Text, Button, Link, Markdown, Code, Input } = $.ui.resolve(e)
  const kit = kitOf($, e, now)
  /** A link to GitLab with what its mark opens shown once the pointer rests on it, in the line under the block `at` draws. */
  const out = (at: HomedKit, key: string, words: string, href: string, text: string) => hinted(at, key, words, <Link href={href}>{text}</Link>)
  /** Such a link on a line of its own, the page's gap under it holding what it opens. */
  const alone = (key: string, words: string, href: string, text: string) => {
    const at = homed(kit, key)
    return (
      <Box flexDirection="row" marginBottom={hintRoom(at)}>
        {out(at, key, words, href, text)}
        {hintLine(at)}
      </Box>
    )
  }
  /** The Markdown element takes only text made for it, so a title or name cannot be drawn as Markdown by accident. */
  const markdown = (text: MarkdownText) => <Markdown text={text} />

  /** GitLab Markdown drawn as GitLab draws it: each `<details>` a toggle under its summary, closed unless asked open. */
  const rich = (parts: Part[], id: string): RenderChildren[] => parts.flatMap((part, i) => richPart(part, id, i))
  const richPart = (part: Part, id: string, i: number): RenderChildren[] => {
    if ('text' in part) {
      return [markdown(part.text)]
    }
    const fold = `${id}.${i}`
    const isOpen = part.isOpen !== folds.includes(fold)
    return [
      <Button key={`fold-${shortHash(fold)}`} plain label={`${isOpen ? '▾' : '▸'} ${part.summary}`} onPress={() => toggleFold($, fold)} />,
      ...(isOpen
        ? [
            <Box flexDirection="column" gap={1} paddingLeft={2}>
              {rich(part.parts, fold)}
            </Box>,
          ]
        : []),
    ]
  }

  /** A note's byline: who wrote it, or, on a page opened on its writer, whether it is in an open thread. */
  const byline = (at: HomedKit, note: Note, place: string, who: string) => (
    <Box flexDirection="row" gap={1}>
      <Box flexShrink={0}>
        <Text weight="semibold">{who}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {[note.where, ago(note.at, now)].filter(Boolean).join(' · ')}
        </Text>
      </Box>
      {out(at, `hint-note-${place}`, opens('comment'), note.url, LINK.comment)}
    </Box>
  )
  /**
   * A note is a block of its own, a gap under it: its 💬 says what it opens there, not over the note's first line. It is
   * named by its place on the page (`t2`, `t2.1`, `b0`, `p3`), not its address: a note GitLab gives none of links to its MR,
   * so two such notes would share one, and the engine draws nothing of a tree with a key twice.
   */
  const said = (note: Note, place: string, who = note.author) => {
    const at = homed(kit, `note-${place}`)
    return (
      <Box flexDirection="column" marginBottom={hintRoom(at)}>
        {byline(at, note, place, who)}
        {rich(partsOf(note.body), `${mr.key}#${note.url.split('#').pop() ?? note.at}`)}
        {hintLine(at)}
      </Box>
    )
  }

  const { verdict } = about
  const atHead = homed(kit, 'page-head')
  const head = [
    <Text size="heading" weight="semibold">
      {mr.title}
    </Text>,
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={hintRoom(atHead)}>
      {out(atHead, 'hint-page-mr', opens('mr'), mr.url, `${LINK.mr} !${mr.iid}`)}
      {out(atHead, 'hint-page-repo', opens('repo'), mr.repo.url, `${LINK.repo} ${mr.repo.name}`)}
      {verdict !== null && (
        <Text weight={verdict.bold ? 'semibold' : undefined} color={verdict.tone}>
          {verdict.words}
        </Text>
      )}
      <Text dimColor>
        {`${mr.branch.source} → ${mr.branch.target}${mr.diff !== null ? ` · +${mr.diff.additions} −${mr.diff.deletions} · ${plural(mr.diff.files, 'file')}` : ''}`}
      </Text>
      {hintLine(atHead)}
    </Box>,
    ...(about.ticket !== null ? [alone('hint-page-ticket', opens('jira'), about.ticket.href, about.ticket.text)] : []),
    ...about.standing.map(line =>
      line.href !== null ? (
        alone(`hint-start-${shortHash(line.href)}`, 'opens the job, to start it', line.href, line.text)
      ) : (
        // What waits on others is said quietly, as the verdict says it; what is yours to act on stands out in its tone.
        <Text weight={line.tone !== undefined ? 'semibold' : undefined} dimColor={line.tone === undefined} color={line.tone}>
          {line.text}
        </Text>
      )
    ),
  ]

  let room = DRAWING_BUDGET - CHROME_SIZE - CUT_NOTE_SIZE - measure(head)
  /** The blocks that fit what is left of the room, in order: the first that does not ends the run. */
  const fitting = (blocks: RenderChildren[]) =>
    blocks.filter(block => {
      const size = measure(block)
      if (size > room) {
        room = 0
        return false
      }
      room -= size
      return true
    })

  // Opened on one person: what they wrote, and the way on to the whole MR.
  const person = focus !== '' ? personPage(mr, focus) : null
  if (person !== null) {
    const notes = fitting(person.notes.map(({ note, label }, i) => said(note, `p${i}`, label)))
    return [
      ...head,
      <Text weight="semibold">{person.heading}</Text>,
      ...notes,
      ...(notes.length < person.notes.length ? [alone('hint-rest-person', opens('mr'), mr.url, `${LINK.mr} The rest of their comments are on GitLab`)] : []),
      <Button key="page-whole" plain label={`the whole of !${mr.iid} ›`} onPress={() => showWhole($)} />,
    ]
  }

  const pipeline = mr.pipeline
  const jobs = [...(pipeline?.failed ?? []).map(job => ({ job, glyph: '✗' })), ...(pipeline?.amber ?? []).map(job => ({ job, glyph: '⚠' }))]
  // One description for the whole list: every link opens its job's log, and a list of a hundred and more jobs leaves room for
  // the threads and the description only if its links are bare.
  const jobsSay = [...((pipeline?.failed.length ?? 0) > 0 ? ['✗ failed'] : []), ...((pipeline?.amber.length ?? 0) > 0 ? ['⚠ allowed to fail'] : []), 'each opens its log']
  /**
   * Under a thread, the way to answer it: a quiet `↩ reply`, then one box at a time, then the text to confirm, since it
   * posts as you. A phone may not have been sent a text field, and a thread read without where its replies go has none:
   * there its 💬 link to GitLab is the way.
   */
  const answering = (thread: Note): RenderChildren[] => {
    if (e.surface === 'mobile' || thread.answer === undefined) {
      return []
    }
    const tag = shortHash(thread.url)
    const cancel = <Button key={`reply-cancel-${tag}`} plain dimColor label="cancel" onPress={() => closeReply($, thread.url)} />
    // How far a reply under this thread got is its entry in the ledger of writes; without one, the box or the press that opens it.
    const write = writes[replyId(thread.url)]
    if (write?.state === 'sent') {
      return [<Text dimColor>posting…</Text>]
    }
    if (write?.state === 'armed' || write?.state === 'failed') {
      // Drawn as a reply is, under a byline that says it is not one yet.
      return [
        <Box flexDirection="column" paddingLeft={2}>
          <Box flexDirection="row" gap={1}>
            <Text weight="semibold">you</Text>
            <Text dimColor>not posted yet</Text>
          </Box>
          <Text>{write.on}</Text>
        </Box>,
        ...(write.state === 'failed' ? [<Text color="warning">{write.say}</Text>] : []),
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Button
            key={`reply-post-${tag}`}
            variant="primary"
            label={write.state === 'failed' ? 'post again' : 'post as you'}
            onPress={() => postReply($, mr.key, mr.host, thread, write.on)}
          />
          <Button key={`reply-edit-${tag}`} plain label="edit" onPress={() => editReply($, thread.url)} />
          {cancel}
        </Box>,
      ]
    }
    if (reply.thread !== thread.url) {
      return [<Button key={`reply-open-${tag}`} plain dimColor label="↩ reply" onPress={() => openReply($, thread.url)} />]
    }
    return [
      <Input
        key="reply-box"
        rows={3}
        autoFocus
        value={reply.text}
        placeholder="Your reply, posted on GitLab as you"
        submitLabel="review"
        onInput={text => typeReply($, thread.url, text)}
        onSubmit={text => confirmReply($, thread.url, text)}
      />,
      ...(reply.say !== '' ? [<Text color="warning">{reply.say}</Text>] : []),
      cancel,
    ]
  }
  const threads = mr.openThreads.map((thread, t) => (
    <Box flexDirection="column" gap={1}>
      {thread.excerpt !== undefined && <Code source={thread.excerpt.hunk} format="diff" path={thread.excerpt.path} wrap="truncate-end" />}
      {said(thread, `t${t}`)}
      {(thread.replies ?? []).map((answer, r) => (
        <Box paddingLeft={2}>{said(answer, `t${t}.${r}`)}</Box>
      ))}
      {answering(thread)}
    </Box>
  ))
  const botNotes = mr.people.filter(each => each.isBot).flatMap(bot => bot.notes.filter(note => note.isOpen).map(note => ({ ...note, author: bot.name })))
  const atJobs = homed(kit, 'page-jobs')
  const blocks = [
    ...(jobs.length > 0
      ? [
          <Box flexDirection="column" marginBottom={hintRoom(atJobs)}>
            <Text weight="semibold" color="error">
              {plural(jobs.length, 'failed job')}
            </Text>
            {hinted(
              atJobs,
              'hint-jobs',
              jobsSay,
              <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                {jobs.map(({ job, glyph }) => (
                  <Link href={job.url}>{`${glyph} ${job.name}`}</Link>
                ))}
              </Box>
            )}
            {hintLine(atJobs)}
          </Box>,
        ]
      : []),
    ...(threads.length > 0
      ? [
          <Text weight="semibold">{plural(threads.length, 'open thread')}</Text>,
          // Where replies go could not be read; the next read tries again.
          ...(mr.repliesOff !== undefined && e.surface !== 'mobile' ? [<Text color="warning" size="footnote">{`↩ Replies are off here: ${mr.repliesOff}`}</Text>] : []),
          ...threads,
        ]
      : []),
    ...(botNotes.length > 0 ? [<Text weight="semibold">{plural(botNotes.length, 'open bot comment')}</Text>, ...botNotes.map((note, i) => said(note, `b${i}`))] : []),
  ]

  const kept = fitting(blocks)

  const described: RenderChildren[] = []
  let isCut = false
  for (const [i, part] of partsOf(mr.description).entries()) {
    const drawn = richPart(part, `${mr.key}#d`, i)
    const size = measure(drawn)
    if (size <= room) {
      described.push(...drawn)
      room -= size
      continue
    }
    const cut = 'text' in part ? cutToFit(part.text, room, text => measure(markdown(text))) : EMPTY_MARKDOWN
    if (cut.length > 0) {
      described.push(markdown(cut))
    }
    isCut = true
    break
  }

  return [
    ...head,
    ...described,
    ...(isCut ? [alone('hint-rest-description', opens('mr'), mr.url, `${LINK.mr} The rest of the description is on GitLab`)] : []),
    ...kept,
    ...(kept.length < blocks.length ? [alone('hint-rest-threads', opens('mr'), mr.url, `${LINK.mr} The rest of the threads are on GitLab`)] : []),
  ]
}
