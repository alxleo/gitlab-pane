// gitlab-schema: checks every query the pane sends GitLab against gitlab.com's live schema, and keeps the types of its answers.
//
//   node tools/gitlab_schema.ts check                          fetch the schema, check the queries, the snapshot and the generated types
//   node tools/gitlab_schema.ts check --schema saved.json      check against an introspection answer saved earlier
//   node tools/gitlab_schema.ts check --save saved.json        keep the fetched schema, to compare later
//   node tools/gitlab_schema.ts snapshot                       fetch the schema and keep the part the queries use, in tools/
//   node tools/gitlab_schema.ts types                          write hooks/gitlab.generated.ts from the snapshot and the queries
//   node tools/gitlab_schema.ts types --check                  fail if that file differs from what the snapshot and queries give; no network
//
// (`npm run schema -- <command>` is the same.) What it catches, before anyone sees an empty pane:
//
//   * a field, argument or enum value GitLab removed or renamed
//   * one GitLab has deprecated, which it removes some releases later (fails too, so there is time to move)
//   * one GitLab marks as an experiment, which may change without a deprecation (said, never failed)
//   * the schema moving under the types: a field turning nullable, an enum gaining a value (the snapshot differs from live)
//
// The tests cannot catch these: their GitLab answers are made up, in the shape the code expects. The queries are
// DOCUMENTS in hooks/gitlab-documents.ts, imported as they are sent. GitLab answers the schema without a sign-in, so this reads no
// token and sends nothing of yours.
//
// It also asks gitlab.com what each document costs: the document is sent with `queryComplexity { score limit }` added, which
// GitLab answers (its limit is 200 without a sign-in, 250 with one, so this is the stricter reading) before it runs anything.
// A document fails when its score is not COMPLEXITY's, or is over COMPLEXITY_SHARE of the limit. `--schema` reads no network,
// so it measures nothing and says so.
//
// The types are made by graphql-codegen (the versions in package-lock.json) from tools/gitlab_schema.snapshot.json: the
// part of the schema the queries use, with its nullability, so a commit needs no network. `check` compares that snapshot
// with the live schema, which is how a change in GitLab reaches the types.
import { executeCodegen } from '@graphql-codegen/cli'
import {
  buildClientSchema,
  getIntrospectionQuery,
  getNamedType,
  Kind,
  parse,
  print,
  TypeInfo,
  validate,
  visit,
  visitWithTypeInfo,
  type DocumentNode,
  type GraphQLSchema,
  type IntrospectionDirective,
  type IntrospectionField,
  type IntrospectionInputValue,
  type IntrospectionQuery,
  type IntrospectionSchema,
  type IntrospectionType,
  type IntrospectionTypeRef,
  type SelectionNode,
} from 'graphql'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'

import { COMPLEXITY, COMPLEXITY_SHARE, DOCUMENTS } from '../hooks/gitlab-documents.ts'
import { isRecord, isSome, parseJson } from '../hooks/decode.ts'

const ROOT = join(import.meta.dirname, '..')
const SNAPSHOT = join(ROOT, 'tools', 'gitlab_schema.snapshot.json')
const TYPES = join(ROOT, 'hooks', 'gitlab.generated.ts')
const QUERIES = join(ROOT, 'hooks', 'gitlab-documents.ts')
const ENDPOINT = 'https://gitlab.com/api/graphql'
/**
 * The deprecated fields a document may still use, each for its own document alone: the variant sent to a host that has
 * said it lacks the newer field. Nothing else is excused.
 */
const OLD_HOST_FIELDS: Readonly<Record<string, { field: string; why: string }>> = {
  InboxTodosPlain: { field: 'Todo.target', why: 'GitLab before 17.4 has no Todo.targetEntity; the document is sent only to a host that answered undefinedField for it' },
}
const EXPERIMENT = 'Status: Experiment'
// GitLab's own directives take its own types, which the queries never use.
const STANDARD_DIRECTIVES = new Set(['skip', 'include', 'deprecated', 'specifiedBy', 'oneOf'])

const USAGE = `usage: node tools/gitlab_schema.ts check [--schema FILE] [--save FILE]
       node tools/gitlab_schema.ts snapshot [--schema FILE]
       node tools/gitlab_schema.ts types [--check]`

/** The check could not be made; exit 2, apart from the queries being wrong (exit 1). */
class SchemaError extends Error {}

type Finding = { readonly query: string; readonly problem: string; readonly fails: boolean }

type Queries = Readonly<Record<string, string>>

const relativeToRoot = (file: string): string => relative(ROOT, file)

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// ---- the schema ---------------------------------------------------------------------------------------------------------

/** An introspection answer: its `__schema` holds a list of types and the query type; graphql-js checks the rest as it builds. */
function isIntrospection(value: unknown): value is IntrospectionQuery {
  if (!isRecord(value) || !isRecord(value['__schema'])) {
    return false
  }
  const schema = value['__schema']
  return Array.isArray(schema['types']) && isRecord(schema['queryType']) && Array.isArray(schema['directives'])
}

/** The answer as GitLab gave it, or as `--save` kept it, which may or may not still be wrapped in `data`. */
function introspectionOf(raw: unknown): IntrospectionQuery {
  const unwrapped = isRecord(raw) && 'data' in raw ? raw['data'] : raw
  if (!isIntrospection(unwrapped)) {
    throw new SchemaError(`not an introspection answer: ${JSON.stringify(raw).slice(0, 500)}`)
  }
  return unwrapped
}

async function fetchIntrospection(): Promise<IntrospectionQuery> {
  const query = getIntrospectionQuery({ descriptions: true, inputValueDeprecation: true })
  let answer: unknown
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'gitlab-pane schema check' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60_000),
    })
    answer = parseJson(await response.text())
  } catch (error) {
    throw new SchemaError(`cannot read GitLab's schema from ${ENDPOINT}: ${messageOf(error)}`)
  }
  if (!isRecord(answer) || !('data' in answer) || answer['errors'] !== undefined) {
    throw new SchemaError(`GitLab did not answer with its schema: ${JSON.stringify(answer).slice(0, 500)}`)
  }
  return introspectionOf(answer)
}

const readIntrospection = (file: string): IntrospectionQuery => introspectionOf(parseJson(readFileSync(file, 'utf8')))

function queriesOfThePane(): Queries {
  const entries = Object.entries(DOCUMENTS)
  if (entries.length === 0) {
    throw new SchemaError(`${relativeToRoot(QUERIES)} holds no queries`)
  }
  return DOCUMENTS
}

// ---- deprecations and experiments ---------------------------------------------------------------------------------------

/** What the query uses that GitLab has deprecated or calls an experiment, from the schema's own notes. */
function marks(schema: GraphQLSchema, name: string, document: DocumentNode): Finding[] {
  const found: Finding[] = []
  const info = new TypeInfo(schema)

  // GitLab marks an experiment as deprecated too, its reason saying so: that one is told, not failed.
  const note = (what: string, reason: string | null | undefined, description: string | null | undefined): void => {
    if ((reason ?? '').includes(EXPERIMENT) || (description ?? '').includes(EXPERIMENT)) {
      found.push({ query: name, problem: `${what} is an experiment, so it may change without notice`, fails: false })
    } else if (OLD_HOST_FIELDS[name]?.field === what) {
      // Named below, for this document alone: it is what a host without the newer field is sent.
    } else if (reason !== undefined && reason !== null && reason !== '') {
      found.push({ query: name, problem: `${what} is deprecated: ${reason}`, fails: true })
    }
  }

  visit(
    document,
    visitWithTypeInfo(info, {
      Field(node) {
        const parent = info.getParentType()
        const field = info.getFieldDef()
        if (isSome(parent) && isSome(field)) {
          note(`${parent.name}.${node.name.value}`, field.deprecationReason, field.description)
        }
      },
      Argument(node) {
        const parent = info.getParentType()
        const field = info.getFieldDef()
        const argument = info.getArgument()
        if (isSome(parent) && isSome(field) && isSome(argument) && !isSome(info.getDirective())) {
          note(`${parent.name}.${field.name}(${node.name.value}:)`, argument.deprecationReason, argument.description)
        }
      },
      EnumValue(node) {
        const kind = getNamedType(info.getInputType())
        const value = isSome(kind) && 'getValues' in kind ? kind.getValues().find(each => each.name === node.value) : undefined
        if (isSome(kind) && isSome(value)) {
          note(`${kind.name}.${node.value}`, value.deprecationReason, value.description)
        }
      },
    })
  )
  return found
}

function checkQueries(schema: GraphQLSchema, queries: Queries): Finding[] {
  return Object.entries(queries).flatMap(([name, text]): Finding[] => {
    const document = parse(text)
    const errors = validate(schema, document)
    return errors.length > 0 ? errors.map(error => ({ query: name, problem: error.message, fails: true })) : marks(schema, name, document)
  })
}

// ---- complexity ---------------------------------------------------------------------------------------------------------

/** What GitLab scores a document at and the most a query may score. */
type Cost = { readonly score: number; readonly limit: number }

const isCost = (value: unknown): value is Cost => isRecord(value) && typeof value['score'] === 'number' && typeof value['limit'] === 'number'

/** Values for the documents' variables: GitLab scores a document before it runs, so any project and number do. */
const SAMPLE_VARIABLES: Readonly<Record<string, string>> = {
  path: 'gitlab-org/gitlab',
  iid: '1',
  since: '2026-01-01T00:00:00Z',
  after: '2026-01-01T00:00:00Z',
  state: 'opened',
  username: 'root',
}

/** GitLab refuses a burst of requests with 429; the schedule is weekly, so waiting out a few is cheap. */
const RATE_LIMIT_TRIES = 4
const RATE_LIMIT_WAIT_MS = 20_000

const SCORING = ((): readonly SelectionNode[] => {
  const [operation] = parse('{ queryComplexity { score limit } }').definitions
  if (operation?.kind !== Kind.OPERATION_DEFINITION) {
    throw new SchemaError('the complexity selection is not an operation')
  }
  return operation.selectionSet.selections
})()

/** The document with GitLab's own score of it added to its operation, and the variables the operation declares. */
function scored(text: string): { readonly query: string; readonly variables: Record<string, string> } {
  const names: string[] = []
  const document = visit(parse(text), {
    VariableDefinition(node) {
      names.push(node.variable.name.value)
    },
    OperationDefinition: {
      leave(node) {
        return { ...node, selectionSet: { ...node.selectionSet, selections: [...node.selectionSet.selections, ...SCORING] } }
      },
    },
  })
  return {
    query: print(document),
    variables: Object.fromEntries(
      names.map(name => {
        const value = SAMPLE_VARIABLES[name]
        if (value === undefined) {
          throw new SchemaError(`no sample value for the variable $${name}; add one to SAMPLE_VARIABLES`)
        }
        return [name, value]
      })
    ),
  }
}

/** What GitLab says one document costs, from gitlab.com with no sign-in. */
async function measure(name: string, text: string): Promise<Cost> {
  const { query, variables } = scored(text)
  for (let attempt = 1; ; attempt += 1) {
    let status: number
    let answer: unknown
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'gitlab-pane schema check' },
        body: JSON.stringify({ query, variables, operationName: name }),
        signal: AbortSignal.timeout(60_000),
      })
      status = response.status
      answer = status === 429 ? null : parseJson(await response.text())
    } catch (error) {
      throw new SchemaError(`cannot ask ${ENDPOINT} what ${name} costs: ${messageOf(error)}`)
    }
    if (status === 429 && attempt < RATE_LIMIT_TRIES) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_WAIT_MS))
      continue
    }
    const cost = isRecord(answer) && isRecord(answer['data']) ? answer['data']['queryComplexity'] : undefined
    if (!isCost(cost)) {
      throw new SchemaError(`GitLab did not score ${name} (HTTP ${status}): ${JSON.stringify(answer).slice(0, 500)}`)
    }
    return cost
  }
}

/** Each scored document's cost beside what COMPLEXITY says and the share of the limit it may take. */
async function complexity(queries: Queries): Promise<Finding[]> {
  const found: Finding[] = []
  for (const [name, expected] of Object.entries(COMPLEXITY)) {
    const text = queries[name]
    if (text === undefined) {
      continue
    }
    const { score, limit } = await measure(name, text)
    const share = Math.round((100 * score) / limit)
    found.push({ query: name, problem: `scores ${score} of GitLab's ${limit} (${share}%)`, fails: false })
    if (score !== expected) {
      found.push({ query: name, problem: `scores ${score}, but COMPLEXITY in ${relativeToRoot(QUERIES)} says ${expected}; state its cost`, fails: true })
    }
    if (score > COMPLEXITY_SHARE * limit) {
      found.push({ query: name, problem: `scores ${score}, over the ${Math.round(100 * COMPLEXITY_SHARE)}% of GitLab's ${limit} a document may take`, fails: true })
    }
  }
  return found
}

// ---- the snapshot -------------------------------------------------------------------------------------------------------

const isTypeRef = (value: unknown): value is IntrospectionTypeRef => isRecord(value) && typeof value['kind'] === 'string'

/** The name of the type an introspection type reference points at, under its list and non-null wrappers. */
function unwrap(ref: IntrospectionTypeRef): string {
  // A real answer has `ofType: null` on a named type; the types leave the key out.
  const inner: unknown = 'ofType' in ref ? ref.ofType : null
  if (isTypeRef(inner)) {
    return unwrap(inner)
  }
  if ('name' in ref) {
    return ref.name
  }
  throw new SchemaError('a type reference wraps nothing and names nothing')
}

type Uses = {
  readonly fields: Map<string, Set<string>>
  readonly arguments: Map<string, Set<string>>
  readonly variables: Set<string>
}

const into = (map: Map<string, Set<string>>, key: string, value: string): void => {
  map.set(key, (map.get(key) ?? new Set<string>()).add(value))
}

/** What the queries use: fields by type, arguments by `Type.field`, and the types of their variables. */
function used(schema: GraphQLSchema, queries: Queries): Uses {
  const uses: Uses = { fields: new Map(), arguments: new Map(), variables: new Set() }
  const info = new TypeInfo(schema)
  for (const text of Object.values(queries)) {
    visit(
      parse(text),
      visitWithTypeInfo(info, {
        Field(node) {
          const parent = info.getParentType()
          if (isSome(parent) && !node.name.value.startsWith('__')) {
            into(uses.fields, parent.name, node.name.value)
          }
        },
        Argument(node) {
          const parent = info.getParentType()
          const field = info.getFieldDef()
          if (isSome(parent) && isSome(field) && !isSome(info.getDirective())) {
            into(uses.arguments, `${parent.name}.${field.name}`, node.name.value)
          }
        },
        VariableDefinition() {
          const kind = getNamedType(info.getInputType())
          if (isSome(kind)) {
            uses.variables.add(kind.name)
          }
        },
      })
    )
  }
  return uses
}

const byName = <T extends { readonly name: string }>(items: readonly T[]): T[] => [...items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

// A real answer carries `null` for what a kind does not have (a scalar's fields); the types leave the key out.
const listOf = <T>(value: readonly T[] | null | undefined): readonly T[] => value ?? []
const orNull = <T>(value: readonly T[] | null | undefined): readonly T[] | null => value ?? null
const fieldsOf = (kind: IntrospectionType): readonly IntrospectionField[] => listOf('fields' in kind ? kind.fields : null)
const inputFieldsOf = (kind: IntrospectionType): readonly IntrospectionInputValue[] | null => orNull('inputFields' in kind ? kind.inputFields : null)
const possibleTypesOf = (kind: IntrospectionType): readonly { readonly name: string }[] | null => orNull('possibleTypes' in kind ? kind.possibleTypes : null)
const interfacesOf = (kind: IntrospectionType): readonly { readonly name: string }[] | null => orNull('interfaces' in kind ? kind.interfaces : null)

/**
 * The introspection answer cut to what the queries use: the fields they select, with their arguments and types in full
 * (nullability is the point), every value of an enum and every field of an input. Descriptions go, so a note GitLab
 * rewrites does not move the snapshot, and everything is sorted, so it moves only when the schema does.
 */
function prune(introspection: IntrospectionQuery, queries: Queries): unknown {
  const full: IntrospectionSchema = introspection.__schema
  const types = new Map(full.types.map(kind => [kind.name, kind]))
  const { fields, arguments: args, variables } = used(buildClientSchema(introspection), queries)
  /** The types the queries reach from the query type: through the fields they select, and the types they name. */
  const reach = (): Set<string> => {
    const reached = new Set<string>()
    const todo = [full.queryType.name, ...variables]
    for (let name = todo.pop(); name !== undefined; name = todo.pop()) {
      if (reached.has(name)) {
        continue
      }
      reached.add(name)
      const kind = types.get(name)
      if (kind === undefined) {
        throw new SchemaError(`the queries use ${name}, which the schema does not hold`)
      }
      for (const field of fieldsOf(kind)) {
        if (fields.get(name)?.has(field.name) === true) {
          todo.push(unwrap(field.type))
          todo.push(...field.args.filter(arg => args.get(`${name}.${field.name}`)?.has(arg.name) === true).map(arg => unwrap(arg.type)))
        }
      }
      todo.push(...(inputFieldsOf(kind) ?? []).map(field => unwrap(field.type)))
      todo.push(...(possibleTypesOf(kind) ?? []).map(possible => possible.name).filter(possible => fields.has(possible)))
    }
    return reached
  }

  /**
   * A type that implements a kept interface must keep each field the queries select on the interface, or the pruned
   * schema is not valid (a query that selects `webUrl` on an interface reaches every kept type that implements it).
   * Gives whether a field was added, which can reach new types.
   */
  const inherit = (reached: ReadonlySet<string>): boolean => {
    let added = false
    for (const name of reached) {
      const kind = types.get(name)
      for (const parent of kind === undefined ? [] : (interfacesOf(kind) ?? [])) {
        for (const field of fields.get(parent.name) ?? []) {
          if (fields.get(name)?.has(field) !== true) {
            into(fields, name, field)
            for (const arg of args.get(`${parent.name}.${field}`) ?? []) {
              into(args, `${name}.${field}`, arg)
            }
            added = true
          }
        }
      }
    }
    return added
  }

  let keep = reach()
  while (inherit(keep)) {
    keep = reach()
  }

  const slimArgument = (arg: IntrospectionInputValue) => ({ ...arg, description: null })

  const slim = (kind: IntrospectionType) => {
    const { name } = kind
    const inputFields = inputFieldsOf(kind)
    const interfaces = interfacesOf(kind)
    const possible = possibleTypesOf(kind)
    return {
      kind: kind.kind,
      name,
      description: null,
      fields:
        kind.kind === 'OBJECT' || kind.kind === 'INTERFACE'
          ? byName(
              fieldsOf(kind)
                .filter(field => fields.get(name)?.has(field.name) === true)
                .map(field => ({
                  ...field,
                  description: null,
                  args: byName(field.args.filter(arg => args.get(`${name}.${field.name}`)?.has(arg.name) === true).map(slimArgument)),
                }))
            )
          : null,
      inputFields: inputFields === null ? null : byName(inputFields.map(slimArgument)),
      interfaces: interfaces === null ? null : byName(interfaces.filter(ref => keep.has(ref.name))),
      enumValues: kind.kind === 'ENUM' ? byName(kind.enumValues.map(value => ({ ...value, description: null }))) : null,
      possibleTypes: possible === null ? null : byName(possible.filter(ref => keep.has(ref.name))),
    }
  }

  const slimDirective = (directive: IntrospectionDirective) => ({ ...directive, description: null, args: directive.args.map(slimArgument) })

  return {
    __schema: {
      queryType: full.queryType,
      mutationType: null,
      subscriptionType: null,
      types: [...keep].sort().flatMap(name => {
        const kind = types.get(name)
        return kind === undefined ? [] : [slim(kind)]
      }),
      directives: byName(full.directives.filter(directive => STANDARD_DIRECTIVES.has(directive.name)).map(slimDirective)),
    },
  }
}

/** The value with every object's keys in order, so the text moves only when the schema does. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sorted)
  }
  return isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value
}

const dump = (snapshot: unknown): string => `${JSON.stringify(sorted(snapshot), null, 1)}\n`

// ---- the generated types ------------------------------------------------------------------------------------------------

/** What graphql-codegen writes for the queries in hooks/gitlab-documents.ts against the schema in the file. */
async function generate(schemaFile: string): Promise<string> {
  const { result, error } = await executeCodegen({
    cwd: ROOT,
    silent: true,
    schema: schemaFile,
    documents: QUERIES,
    generates: {
      [TYPES]: {
        plugins: ['typescript-operations'],
        config: {
          // Types only (no runtime enums), and only the ones a query uses.
          enumsAsTypes: true,
          skipTypename: true,
          useTypeImports: true,
          // A scalar not named below is `unknown`, so a new one cannot slip in as `any`.
          defaultScalarType: 'unknown',
          scalars: { ID: 'string', Time: 'string', NoteID: 'string' },
        },
      },
    },
  })
  const made = result.find(output => output.filename === TYPES)
  if (error !== null || made === undefined) {
    throw new SchemaError(`graphql-codegen failed: ${error === null ? 'it made no file' : messageOf(error)}`)
  }
  return made.content
}

function stale(file: string, now: string): Finding | null {
  let held: string | null = null
  try {
    held = readFileSync(file, 'utf8')
  } catch {
    held = null
  }
  if (held === now) {
    return null
  }
  const command = file === SNAPSHOT ? 'snapshot' : 'types'
  return { query: relativeToRoot(file), problem: `is not what the schema and queries give now; run \`npm run schema -- ${command}\` and commit it`, fails: true }
}

// ---- the commands -------------------------------------------------------------------------------------------------------

async function check(schemaFile: string | undefined, save: string | undefined): Promise<number> {
  const queries = queriesOfThePane()
  const introspection = schemaFile === undefined ? await fetchIntrospection() : readIntrospection(schemaFile)
  if (save !== undefined) {
    writeFileSync(save, JSON.stringify(introspection))
  }
  const schema = buildClientSchema(introspection)
  const snapshot = dump(prune(introspection, queries))
  const scratch = mkdtempSync(join(tmpdir(), 'gitlab-schema-'))
  let types: string
  try {
    const live = join(scratch, 'live.json')
    writeFileSync(live, snapshot)
    types = await generate(live)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  const costs = schemaFile === undefined ? await complexity(queries) : []
  if (schemaFile !== undefined) {
    console.log('· complexity: not measured, as --schema reads no network')
  }
  const findings = [...checkQueries(schema, queries), ...costs, ...[stale(SNAPSHOT, snapshot), stale(TYPES, types)].filter(found => found !== null)]
  for (const finding of findings) {
    console.log(`${finding.fails ? '✗' : '·'} ${finding.query}: ${finding.problem}`)
  }
  const failed = findings.filter(finding => finding.fails).length
  console.log(`${Object.keys(queries).length} queries checked against GitLab's schema: ${failed > 0 ? failed : 'none'} wrong, deprecated or stale.`)
  return failed > 0 ? 1 : 0
}

async function snapshot(schemaFile: string | undefined): Promise<number> {
  const queries = queriesOfThePane()
  const introspection = schemaFile === undefined ? await fetchIntrospection() : readIntrospection(schemaFile)
  writeFileSync(SNAPSHOT, dump(prune(introspection, queries)))
  console.log(`wrote ${relativeToRoot(SNAPSHOT)}; now \`types\` for the types.`)
  return 0
}

async function types(checking: boolean): Promise<number> {
  const made = await generate(SNAPSHOT)
  if (!checking) {
    writeFileSync(TYPES, made)
    console.log(`wrote ${relativeToRoot(TYPES)}`)
    return 0
  }
  const found = stale(TYPES, made)
  if (found !== null) {
    console.log(`✗ ${found.query}: ${found.problem}`)
    return 1
  }
  // The weekly check sends every document with sample variables; a variable without one would fail only there.
  for (const [name, text] of Object.entries(DOCUMENTS)) {
    try {
      scored(text)
    } catch (error) {
      console.log(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
  }
  console.log(`${relativeToRoot(TYPES)} is what the snapshot and queries give.`)
  return 0
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      schema: { type: 'string' },
      save: { type: 'string' },
      check: { type: 'boolean', default: false },
    },
  })
  const [command] = positionals
  if (command === 'check') {
    return check(values.schema, values.save)
  }
  if (command === 'snapshot') {
    return snapshot(values.schema)
  }
  if (command === 'types') {
    return types(values.check)
  }
  console.error(USAGE)
  return 2
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`gitlab-schema: ${messageOf(error)}`)
  process.exitCode = 2
}
