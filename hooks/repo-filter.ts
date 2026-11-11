// The repo filter above Mine: which repos it offers, which one is picked, and when a pick stops counting.

import { LINK } from './drawing.ts'

import type { MrCard } from '../types'

/** 📁, then All and each repo by how many MRs it holds, and the one picked. */
export type RepoFilter = { mark: string; value: string; choices: { value: string; label: string }[] }

/** The value the repo filter's All is picked by; a repo's is its project, `host/path`, which has a `/` and so is never this. */
export const REPO_ALL = 'all'

/** The repo a pick of the filter narrows the list to: its project, or none for All. */
export const pickedRepo = (value: string): string => (value === REPO_ALL ? '' : value)

/**
 * The repo picked, while it still narrows the list: there are repos to pick between, among the `projects` the open MRs are
 * in, and its own is one of them. Else none, so a pick never hides MRs behind a filter that is not drawn or does not offer it.
 */
export const keptRepo = (pick: string, projects: ReadonlySet<string>): string => (projects.size > 1 && projects.has(pick) ? pick : '')

/**
 * The filter over the open `rows`, whose `repos` are each project with how many MRs it holds, most first; none with fewer
 * than two repos to pick between. The repo link's mark says what is picked between, so All needs no word for it, and counts
 * nothing: the Mine tab beside it already says how many.
 */
export function repoFilterOf(rows: readonly MrCard[], repos: readonly (readonly [string, number])[], pick: string): RepoFilter | null {
  const name = (project: string) => rows.find(row => row.project === project)?.repo.name ?? project
  return repos.length > 1
    ? {
        mark: LINK.repo,
        value: pick === '' ? REPO_ALL : pick,
        choices: [{ value: REPO_ALL, label: 'All' }, ...repos.map(([project, count]) => ({ value: project, label: `${name(project)} · ${count}` }))],
      }
    : null
}
