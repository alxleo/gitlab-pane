import type { EngineInterface } from 'claude-code'

import { readOpened } from './choices'
import { readDetails, readRows, setDetails } from './data'
import { joined, serialised } from './in-flight'
import { readWhole } from './read-gitlab'

// The cards the sessions share leave out their description and the threads' words (slim.ts). The MR the person reads
// whole is read once more on its own, by the session whose pane it is, and kept in that session's memory while its page
// stays open; the page draws the shared card with those words put back.

/**
 * Reads the card `key` whole unless it is held whole already as it stands now, with where its replies go; or when
 * `isAgain` (a reply was just posted from its page, which the shared card cannot know yet). A card that is not a row is left.
 */
export async function ensureDetail($: EngineInterface, key: string, isAgain = false): Promise<void> {
  const [row, held] = await Promise.all([readRows($).then(rows => rows.find(each => each.key === key)), readDetails($)])
  const isHeld = held[key]?.updatedAt === row?.updatedAt && held[key]?.repliesOff === undefined
  if (row === undefined || (!isAgain && isHeld)) {
    return
  }
  const work = async () => {
    const whole = await readWhole($, { url: row.url, host: row.host, path: row.path, iid: row.iid })
    const opened = await readOpened($)
    await setDetails($, each => opened.includes(each), whole ?? undefined)
  }
  // A read already out began before the reply, so reading again waits for it and then reads; otherwise the one out will do.
  await (isAgain ? serialised(`detail:${key}`, work) : joined(`detail:${key}`, work))
}

/**
 * After a read, whether or not the list changed: lets go of an MR whose page closed, and reads again the one open if it
 * changed since it was read whole, or if where its replies go could not be read then.
 */
export async function refreshDetails($: EngineInterface): Promise<void> {
  const opened = await readOpened($)
  await setDetails($, key => opened.includes(key))
  await Promise.all(opened.map(key => ensureDetail($, key)))
}
