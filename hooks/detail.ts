import type { EngineInterface } from 'claude-code'

import { readOpened } from './choices'
import { readDetails, readRows, setDetails } from './data'
import { joined } from './in-flight'
import { readWhole } from './read-gitlab'

// The cards the sessions share leave out their description and the threads' words (slim.ts). The MR the person reads
// whole is read once more on its own, by the session whose pane it is, and kept in that session's memory while its page
// stays open; the page draws the shared card with those words put back.

/** Reads the card `key` whole unless it is held whole already as it stands now; a card that is not a row is left. */
export async function ensureDetail($: EngineInterface, key: string): Promise<void> {
  const [row, held] = await Promise.all([readRows($).then(rows => rows.find(each => each.key === key)), readDetails($)])
  if (row === undefined || held[key]?.updatedAt === row.updatedAt) {
    return
  }
  await joined(`detail:${key}`, async () => {
    const whole = await readWhole($, { url: row.url, host: row.host, path: row.path, iid: row.iid })
    const opened = await readOpened($)
    await setDetails($, each => opened.includes(each), whole ?? undefined)
  })
}

/** After a read: lets go of an MR whose page closed, and reads again the one open if it changed since it was read whole. */
export async function refreshDetails($: EngineInterface): Promise<void> {
  const opened = await readOpened($)
  await setDetails($, key => opened.includes(key))
  await Promise.all(opened.map(key => ensureDetail($, key)))
}
