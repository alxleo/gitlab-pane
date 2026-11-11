import type { EngineInterface } from 'claude-code'

import { changeReads, readHosts, readReads } from './data'
import { followInbox, leadInbox, sharedInboxAt } from './inbox'
import { INBOX_LEASE_KEY, leaseTick } from './lease-store'
import { INBOX_EVERY_MS, isInboxDue } from './snapshot'

// Who reads the inbox. While a pane is drawn somewhere, the leader of the first lease reads it with everything else and
// the other sessions show its read. While none is, nobody leads that lease, yet the band above the prompt still wants the
// count: the sessions that have a window elect one of their own under the inbox's lease, which reads the inbox alone, at
// the same pace, and the rest show its read. A session with no window has no band, and reads nothing for one.

/** One read of the inbox, when it is due (the pace, or a person asked for a read, which `isAsked` says): shared in the store, and drawn here. */
export async function inboxPass($: EngineInterface, hosts: readonly string[], isDue: boolean, at: number, isAsked: boolean): Promise<void> {
  if (isDue) {
    await changeReads($, state => ({ ...state, inboxAt: at }))
    await leadInbox($, hosts, isAsked)
  }
}

/**
 * Shows the inbox another session read, when that changed or a minute has passed, which is how often it looks at the
 * marks (a mark is kept in the store by whichever session it was made in).
 */
export async function followInboxTick($: EngineInterface): Promise<void> {
  const [reads, shared, now] = await Promise.all([readReads($), sharedInboxAt($), $.clock.now()])
  if (shared !== null && (shared !== reads.inboxSeen || now - (reads.inboxAt ?? 0) >= INBOX_EVERY_MS)) {
    const seen = await followInbox($)
    await changeReads($, state => ({ ...state, inboxAt: now, inboxSeen: seen }))
  }
}

/**
 * The inbox's turn in a session that no pane's leader serves: it reads the inbox for all, or shows the read of the one that
 * does. A store it cannot read or write elects no one, or every session with a window would read: it then reads nothing.
 */
export async function inboxAlone($: EngineInterface): Promise<void> {
  const hasWindow = (await $.session.surfaces()).length > 0
  const { role, problem } = await leaseTick($, { isDrawing: hasWindow, raisedPins: 0 }, INBOX_LEASE_KEY)
  if (problem !== null) {
    return
  }
  if (role === 'leader') {
    const [reads, hosts, now] = await Promise.all([readReads($), readHosts($), $.clock.now()])
    await inboxPass($, hosts, isInboxDue(reads.inboxAt, now, false), now, false)
  } else if (role === 'follower') {
    await followInboxTick($)
  }
}
