import { expect, test } from 'claude-code/testing'

import { PANE_ID } from '../hooks/panes'
import { PANE } from '../hooks/register'

// register.tsx has to spell the pane's id as a const, because the engine reads a hook's matcher from literals and consts
// there, and panes.ts opens and scrolls the pane by its own PANE_ID. If the two drift, the pane draws nothing.
test('the id the render hook matches is the id the pane is opened and scrolled by', () => {
  expect(PANE).toBe(PANE_ID)
})
