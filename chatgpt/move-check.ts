// Checks a merge from the panel end to end against the made-up GitLab, through the MCP server as the panel calls it:
// one press only arms, a second merges and is followed until GitLab says merged, and the model cannot see the tool.
//
//   node --import ./tools/resolve_ts.ts chatgpt/move-check.ts
import { strict as assert } from 'node:assert'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { Failure } from '../hooks/failure.ts'
import type { RowModel } from '../hooks/pane-model.ts'
import { fakeGitLab } from './fake.ts'
import { connect, openMrs } from './read.ts'
import { panelHtml } from './panel-build.ts'
import { metaString, outcomeIn, panelIn, rowsOf } from './result.ts'
import { createServer } from './server.ts'

const gitlab = fakeGitLab()
const client = new Client({ name: 'check', version: '0' })
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
await createServer({ html: await panelHtml(), connectTo: () => gitlab }).connect(serverSide)
await client.connect(clientSide)

const moveOf = (row: RowModel | undefined) => row?.verdict?.move ?? null
const press = (key: string, does: 'arm' | 'make') => client.callTool({ name: 'press_move', arguments: { key, kind: 'merge', does } })

try {
  const { tools } = await client.listTools()
  const tool = tools.find(each => each.name === 'press_move')
  const ui = tool?._meta?.ui
  assert.ok(typeof ui === 'object' && ui !== null && 'visibility' in ui, 'press_move names who may call it')
  assert.deepEqual(ui.visibility, ['app'], 'press_move is for the panel alone')
  assert.notEqual(metaString(tool?._meta, 'ui', 'resourceUri'), '')

  const first = await client.callTool({ name: 'list_my_mrs', arguments: {} })
  const listed = rowsOf(panelIn(first._meta))
  const ready = listed.find(row => moveOf(row)?.press?.kind === 'merge')
  assert.ok(ready !== undefined, 'the made-up MR that can merge offers ✓ merge')
  assert.equal(moveOf(ready)?.press?.does, 'arm')
  assert.equal(Object.keys(panelIn(first._meta)?.handOff ?? {}).length, 1, 'the MR with conflicts has a task to hand on')
  const other = listed.flatMap(row => {
    const move = moveOf(row)
    return row !== ready && move !== null ? [`!${row.key.split('!')[1] ?? ''} ${move.label}`] : []
  })

  const armed = await press(ready.key, 'arm')
  assert.deepEqual(outcomeIn(armed.structuredContent), { state: 'armed' })
  assert.deepEqual(gitlab.writes, [], 'one press sends nothing')
  const again = moveOf(rowsOf(panelIn(armed._meta)).find(row => row.key === ready.key))
  assert.ok(again !== null, 'the armed row still offers its move')
  assert.equal(again.isArmed, true, 'the row asks for the second press')
  assert.equal(again.press?.does, 'make')

  const made = await press(ready.key, 'make')
  assert.deepEqual(outcomeIn(made.structuredContent), { state: 'ended', say: 'merged', isDone: true })
  assert.deepEqual(gitlab.writes, ['405@head-405'], 'one merge, on the head the row was read on')
  assert.ok(!rowsOf(panelIn(made._meta)).some(row => row.key === ready.key), 'the merged MR leaves the list')

  // A gateway's error page is said as the server failing, after the one more try a read gets, never as a parse error.
  let sent = 0
  const down = connect('gitlab.example.com', {
    token: 'made-up',
    source: 'the environment',
    send: async () => {
      sent += 1
      return { status: 502, text: async () => '<html>Bad gateway</html>' }
    },
  })
  const failure = await openMrs(down).catch((error: unknown) => error)
  assert.ok(failure instanceof Failure, 'a 502 page is a Failure')
  assert.equal(failure.kind, 'server')
  assert.equal(failure.message, 'gitlab.example.com answered HTTP 502')
  assert.equal(sent, 2, 'a read is sent once more after a 502')

  console.log(
    `ok: !405 armed ("${again.label}"), then merged (${gitlab.writes.join('; ')}); other moves offered: ${other.length > 0 ? other.join(', ') : 'none'}; a 502 is the server failing`
  )
} finally {
  await client.close()
}
