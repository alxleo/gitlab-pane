// A stand-in for ChatGPT's side of the panel, to see it drawn without installing anything into ChatGPT: the host page of
// `host.ts` around the panel, answering its tool calls through the real server in memory. By default GitLab's answer is
// made up (the repo's test fixtures), so a picture shows no real MR. `panel-test.ts` drives the same page headless.
//
//   node harness.ts [--port 4319] [--live]
import { parseArgs } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { fakeGitLab } from './fake.ts'
import { serveHost } from './host.ts'
import { panelHtml } from './panel-build.ts'
import { connect } from './read.ts'
import { createServer } from './server.ts'

const { values } = parseArgs({ options: { port: { type: 'string', default: '4319' }, live: { type: 'boolean', default: false } } })

// Live reads (and writes!) the real GitLab; by default a made-up one answers, and a merge there merges nothing real.
const gitlabFor = values.live ? connect : () => fakeGitLab()

const client = new Client({ name: 'harness', version: '0' })
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
await createServer({ html: await panelHtml(), connectTo: gitlabFor }).connect(serverSide)
await client.connect(clientSide)
const { url } = await serveHost(client, { port: Number(values.port) })
console.log(`harness on ${url} (${values.live ? 'live GitLab' : 'made-up MRs'})`)
