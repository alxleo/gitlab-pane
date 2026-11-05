import type { Operations, RawResponse } from '../hooks/gitlab.ts'

/** The operation a `glab api graphql` command line asks for, and the variables sent beside it. */
export type Asked = { operation: string; variables: Record<string, string> }

/** What a command line asks of GitLab, or undefined for any other command. */
export function asked(argv: readonly string[]): Asked | undefined {
  const query = argv.find(arg => arg.startsWith('query='))
  if (!argv.includes('glab') || query === undefined) {
    return undefined
  }
  const operation = /^\s*query\s+(\w+)/m.exec(query)?.[1]
  if (operation === undefined) {
    throw new Error(`a GraphQL document with no operation name: ${query.slice(0, 80)}`)
  }
  const variables: Record<string, string> = {}
  argv.forEach((arg, i) => {
    const [name = '', ...value] = arg.split('=')
    if (argv[i - 1] === '-f' && name !== 'query') {
      variables[name] = value.join('=')
    }
  })
  return { operation, variables }
}

/** GitLab's answer to each operation the pane sends, typed by the document's generated types. A test sets the ones it needs. */
export type Answers = {
  [Name in keyof Operations]?: (variables: Operations[Name]['variables']) => RawResponse<Operations[Name]['data']>
}

const need = (variables: Record<string, string>, name: string): string => {
  const value = variables[name]
  if (value === undefined) {
    throw new Error(`the request left out the ${name} variable`)
  }
  return value
}

const set = <Handler>(handler: Handler | undefined, operation: string): Handler => {
  if (handler === undefined) {
    throw new Error(`the test set no answer for the ${operation} operation`)
  }
  return handler
}

/** The JSON text GitLab would print for the command line, or undefined when it is not a GraphQL one. */
export function answered(argv: readonly string[], answers: Answers): string | undefined {
  const request = asked(argv)
  if (request === undefined) {
    return undefined
  }
  const { operation, variables } = request
  switch (operation) {
    case 'Authored':
      return JSON.stringify(set(answers.Authored, operation)({}))
    case 'MergeStatus':
      return JSON.stringify(set(answers.MergeStatus, operation)({}))
    case 'Pinned':
      return JSON.stringify(set(answers.Pinned, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    case 'Usual':
      return JSON.stringify(set(answers.Usual, operation)({ path: need(variables, 'path') }))
    default:
      throw new Error(`the pane sent an operation the fake does not know: ${operation}`)
  }
}
