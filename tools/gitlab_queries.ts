// Prints every GraphQL document the pane sends GitLab, as one JSON object of operation name to text, for
// tools/gitlab_schema.py to check against gitlab.com's live schema and to cut the schema's snapshot to. Node runs it as
// it is, types stripped, so hooks/gitlab-documents.ts and every core file it imports at run time name their imports with the .ts
// extension, which the engine resolves too.
import { DOCUMENTS } from '../hooks/gitlab-documents.ts'

console.log(JSON.stringify(DOCUMENTS))
