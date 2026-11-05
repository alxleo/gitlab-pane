/** What a fake `glab api graphql` answers with: the operation it was asked for, and the variables sent beside it. */
export type Asked = { operation: string; variables: Record<string, string> }

/** The operation a `glab api graphql` command line names, or undefined for any other command. */
export function asked(argv: readonly string[]): Asked | undefined {
  const query = argv.find(arg => arg.startsWith('query='))
  if (!argv.includes('glab') || !query) {
    return undefined
  }
  const operation = /^\s*query\s+(\w+)/m.exec(query)?.[1]
  if (!operation) {
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

/** One answer per operation, by its name. An operation the test did not set an answer for fails the test. */
export type Answers = Record<string, (variables: Record<string, string>) => unknown>

/** The JSON text GitLab would print for the command line, or undefined when it is not a GraphQL one. */
export function answered(argv: readonly string[], answers: Answers): string | undefined {
  const request = asked(argv)
  if (!request) {
    return undefined
  }
  const answer = answers[request.operation]
  if (!answer) {
    throw new Error(`nothing answers the ${request.operation} operation`)
  }
  return JSON.stringify(answer(request.variables))
}
