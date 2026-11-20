// The fields of an MR and of a note as the inbox reads them, shared by its documents (the `ask-inbox-*.ts` modules). A host
// without a field here (`mergeUser`, `systemNoteMetadata`) needs a GitLab older than the ones the pane supports, so these
// have no plain variants.

const INBOX_MR_FRAGMENT = /* GraphQL */ `
  fragment InboxMrFields on MergeRequest {
    iid state title webUrl draft createdAt
    author { username name }
    project { fullPath }
  }
`

// The last 30 notes of an MR, newest last. A system note's action says what it was: approved, unapproved,
// requested_changes, reviewed and commit (a push) are the ones the inbox counts.
const INBOX_NOTE_FRAGMENT = /* GraphQL */ `
  fragment InboxNoteFields on Note {
    id body system createdAt
    author { username name bot }
    ...InboxNoteActionFields
  }
`

// The fields a host may lack are fragments of their own, so a variant of a document without one is the document without
// its fragment. A system note's action says what it was.
const INBOX_NOTE_ACTION_FRAGMENT = /* GraphQL */ `
  fragment InboxNoteActionFields on Note {
    systemNoteMetadata { action }
  }
`

const INBOX_MERGED_BY_FRAGMENT = /* GraphQL */ `
  fragment InboxMergedByFields on MergeRequest {
    mergedAt
    mergeUser { username name }
  }
`

// What says which commit a merge put on its target branch, for the user's own MRs alone (the Mine tab's merged ones): the merge
// commit, which a fast-forward merge has none of, and the head the MR had, which such a merge puts there unless it squashed.
// GraphQL has no squash commit; the pane reads that over REST (landed.ts).
const INBOX_LANDED_FRAGMENT = /* GraphQL */ `
  fragment InboxLandedFields on MergeRequest {
    targetBranch mergeCommitSha diffHeadSha
  }
`

/** The inbox's fragments, in the order a document carries those it uses (`documentOf`). */
export const INBOX_FRAGMENTS = [INBOX_MR_FRAGMENT, INBOX_NOTE_FRAGMENT, INBOX_NOTE_ACTION_FRAGMENT, INBOX_MERGED_BY_FRAGMENT, INBOX_LANDED_FRAGMENT] as const
