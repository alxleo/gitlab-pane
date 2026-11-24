// What every question to GitLab is made of: the request the pane sends, and the answer GitLab gives. Each `ask-*.ts` module
// builds its own requests and reads its own answers; gitlab-operations.ts names every operation they send.
import type { Operations } from './gitlab-operations'

/**
 * A document with the operation name it carries, its variables, and (in the type alone, never set) what GitLab answers
 * it with. The variables are strings, or a merge's `squash` flag, as the documents declare them.
 */
export type Request<Data> = { operation: keyof Operations; query: string; variables: Record<string, string | boolean>; readonly answer?: Data }

/** GitLab's answer to a document: its data, or none, and the errors beside either. */
export type RawResponse<Data> = {
  data?: Data | null
  errors?: { message: string; extensions?: { code?: string; typeName?: string; fieldName?: string; name?: string; argumentName?: string } }[]
}
