// Checks a merge from the panel end to end against the made-up GitLab, through the MCP server as the panel calls it:
// one press only arms, a second merges and is followed until GitLab says merged, and the model cannot see the tool.
import { strict as assert } from 'node:assert'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import type { RowModel } from '../../hooks/pane-model.ts'
import { fakeGitLab } from './fake.ts'
import type { Panel } from './read.ts'
import { createServer } from './server.ts'

const gitlab = fakeGitLab()
const client = new Client({ name: 'check', version: '0' })
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
await createServer(() => gitlab).connect(serverSide)
await client.connect(clientSide)

const panelIn = (result: { _meta?: Record<string, unknown> | undefined }): Panel => result._meta?.gitlabPane as Panel
const rowsIn = (result: { _meta?: Record<string, unknown> | undefined }): RowModel[] => panelIn(result).sections.flatMap(section => section.rows)
const moveOf = (row: RowModel | undefined) => row?.verdict?.move ?? null
const press = (key: string, does: 'arm' | 'make') => client.callTool({ name: 'press_move', arguments: { key, kind: 'merge', does } })

const { tools } = await client.listTools()
const visibility = (tools.find(tool => tool.name === 'press_move')?._meta?.ui as { visibility?: string[] } | undefined)?.visibility
assert.deepEqual(visibility, ['app'], 'press_move is for the panel alone')

const first = await client.callTool({ name: 'list_my_mrs', arguments: {} })
const listed = rowsIn(first)
const ready = listed.find(row => moveOf(row)?.press?.kind === 'merge')
assert.ok(ready !== undefined, 'the made-up MR that can merge offers ✓ merge')
assert.equal(moveOf(ready)?.press?.does, 'arm')
assert.ok(Object.keys(panelIn(first).handOff).length === 1, 'the MR with conflicts has a task to hand on')
const other = listed.filter(row => row !== ready && moveOf(row) !== null).map(row => `!${row.key.split('!')[1]} ${moveOf(row)?.label}`)

const armed = await press(ready.key, 'arm')
assert.equal((armed.structuredContent as { outcome: { state: string } }).outcome.state, 'armed')
assert.deepEqual(gitlab.writes, [], 'one press sends nothing')
const again = moveOf(rowsIn(armed).find(row => row.key === ready.key))
assert.equal(again?.isArmed, true, 'the row asks for the second press')
assert.equal(again?.press?.does, 'make')

const made = await press(ready.key, 'make')
assert.deepEqual((made.structuredContent as { outcome: unknown }).outcome, { state: 'ended', say: 'merged', isDone: true })
assert.deepEqual(gitlab.writes, ['merge !405 on head-405'])
assert.ok(!rowsIn(made).some(row => row.key === ready.key), 'the merged MR leaves the list')

console.log(`ok: !405 armed ("${again?.label}"), then merged (${gitlab.writes.join('; ')}); other moves offered: ${other.join(', ') || 'none'}`)
await client.close()
