// Prints every GraphQL query the pane sends GitLab, as one JSON object of name to query, for tools/gitlab_schema.py to
// check against gitlab.com's live schema. Node runs it as it is, types stripped, so hooks/gitlab.ts and every core file
// it imports at run time name their imports with the .ts extension, which the engine resolves too.
import { authoredQuery, mergeStatusQuery, PINS_PER_QUERY, pinnedQuery, usualQuery } from '../hooks/gitlab.ts'

const pins = Array.from({ length: PINS_PER_QUERY }, (_, i) => ({ project: 'group/project', iid: i + 1 }))

console.log(
  JSON.stringify({
    authored: authoredQuery(),
    mergeStatus: mergeStatusQuery(),
    pinned: pinnedQuery(pins),
    usual: usualQuery(['group/project', 'group/other']),
  })
)
