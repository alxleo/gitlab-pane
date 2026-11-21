import type { EngineInterface } from 'claude-code'

import { addedRefusal, addReviewerWrite } from './ask-add-reviewer'
import { readRows } from './data'
import { REVIEWER_IDS, reviewerId } from './face-model'
import { quietly } from './failures'
import { ask } from './graphql'
import { askForRefresh } from './shared'
import { confirmedPress, refusalOf } from './write-model'
import { claimWrite, expireArm, setWrite } from './writes'

import type { Write } from '../types'

// Adding someone GitLab suggests as a reviewer, from the press beside their faded face: the first press arms it, a second
// within its time sends it, once, and GitLab tells them. Who is suggested and what the press says are face-model.ts's to
// decide; this file sends it. Each add is an entry in the ledger of writes (writes.ts), `reviewer:`, the card key and
// the username.

/** Records how an add ended, and forgets the adds on MRs no longer listed. */
async function settle($: EngineInterface, id: string, write: Write): Promise<void> {
  const listed = (await readRows($)).map(row => reviewerId(row.key, ''))
  await setWrite($, id, write, each => !each.startsWith(REVIEWER_IDS) || listed.some(prefix => each.startsWith(prefix)))
}

async function press($: EngineInterface, key: string, username: string, does: 'arm' | 'make'): Promise<void> {
  const card = (await readRows($)).find(row => row.key === key)
  if (card === undefined) {
    return
  }
  const id = reviewerId(key, username)
  const at = await $.clock.now()
  const pressed = await claimWrite($, id, held => confirmedPress('reviewer', held, username, at, does))
  if (pressed === null) {
    return
  }
  if (pressed.state === 'armed') {
    expireArm($, id, at)
    return
  }
  const refusal = await ask($, card.host, addReviewerWrite(card.path, card.iid, username)).then(
    response => addedRefusal(card.host, username, response),
    (error: unknown) => refusalOf(error)
  )
  if (refusal === null) {
    // Said as added until the read this asks for shows them as a reviewer.
    await settle($, id, { kind: 'reviewer', state: 'handed', on: username, at })
    $.ui.toast(`!${card.iid}: asked ${username} to review`)
    await askForRefresh($)
    return
  }
  const say = refusal.mayHaveLanded ? `${refusal.reason}; it may have reached GitLab, so look before adding again` : refusal.reason
  await settle($, id, { kind: 'reviewer', state: 'failed', on: username, at, say })
  $.ui.toast(`!${card.iid}: ${say}`)
}

/** The press beside a suggested face: `arm` asks for a second press, `make` adds them on a live arm. */
export function pressSuggested($: EngineInterface, key: string, username: string, does: 'arm' | 'make'): void {
  quietly($, press($, key, username, does))
}
