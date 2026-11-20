import { expect, test } from 'vitest'

import { postedOf } from '../../hooks/ask-reply.ts'
import { decodeGraphql, parseJson } from '../../hooks/decode.ts'
import type { ReplyMutation } from '../../hooks/gitlab.generated.ts'
import type { RawResponse } from '../../hooks/gitlab-request.ts'

/** GitLab's answer as the pane reads it: through the JSON a host sends. */
const answer = (raw: unknown): RawResponse<ReplyMutation> => decodeGraphql<ReplyMutation>(parseJson(JSON.stringify(raw)))

test('a reply GitLab kept is posted; one it refused, would not keep, or ran as quick actions alone says why in one line', () => {
  /** GitLab answered, and kept no note: the reply was not made. */
  const not = (reason: string) => ({ reason, mayHaveLanded: false })
  expect(postedOf('gitlab.com', answer({ data: { createNote: { errors: [], note: { id: 'gid://gitlab/Note/9' }, quickActionsStatus: null } } }))).toBeNull()
  // A token of read_api alone may not write: GitLab refuses the whole mutation, with no word of the scope.
  const refusal = answer({
    data: { createNote: null },
    errors: [{ message: "The resource that you are attempting to access does not exist or you don't have permission to perform this action" }],
  })
  expect(postedOf('gitlab.com', refusal)).toEqual(
    not(
      "gitlab.com refused the reply: The resource that you are attempting to access does not exist or you don't have permission to perform this action. A token with only the read_api scope is refused so; replying needs api."
    )
  )
  expect(postedOf('gitlab.com', answer({ data: { createNote: { errors: ["Note can't be blank", 'Note is\ntoo long'], note: null, quickActionsStatus: null } } }))).toEqual(
    not("gitlab.com did not post the reply: Note can't be blank; Note is too long")
  )
  expect(postedOf('gitlab.com', answer({ data: { createNote: { errors: [], note: null, quickActionsStatus: { commandsOnly: true, errorMessages: [] } } } }))).toEqual(
    not('gitlab.com ran the quick actions in the reply and kept no note')
  )
  expect(
    postedOf(
      'gitlab.com',
      answer({ data: { createNote: { errors: [], note: null, quickActionsStatus: { commandsOnly: true, errorMessages: ['Could not apply merge command.'] } } } })
    )
  ).toEqual(not('gitlab.com ran the quick actions in the reply and kept no note: Could not apply merge command.'))
  expect(postedOf('gitlab.com', answer({ data: null }))).toEqual(not('gitlab.com sent no answer to the reply'))
})
