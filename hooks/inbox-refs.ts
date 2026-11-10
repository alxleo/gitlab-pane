// The addresses `/mrs` takes besides an MR's URL: `repo!iid`, `group/project!iid`, and a git remote for the repo of the session.
import { bareHost } from './hosts.ts'

/** An MR named by its project path, whole or from the end (`p`, `g/p`), and its number. */
export type MrRef = { path: string; iid: number }

/** `group/project!7` or `project!7` as a reference; anything else is null. */
export function parseRef(text: string): MrRef | null {
  const match = /^([\w.-]+(?:\/[\w.-]+)*)!(\d+)$/.exec(text.trim())
  return match?.[1] === undefined || match[2] === undefined ? null : { path: match[1], iid: Number(match[2]) }
}

/** Whether a project path is the one a reference names, which may leave off the groups before it. */
export const isRefTo = (ref: MrRef, path: string, iid: number): boolean => ref.iid === iid && (path === ref.path || path.endsWith(`/${ref.path}`))

/**
 * The host and project of a git remote: `git@host:group/project.git`, `ssh://git@host:2222/group/project.git` or
 * `https://host/group/project`. An ssh port is not the web port, so only an https remote keeps one.
 */
export function parseRemote(remote: string): { host: string; path: string } | null {
  const scp = /^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/.exec(remote.trim())
  const url = /^(ssh|https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote.trim())
  const host = bareHost(scp?.[1] ?? (url?.[1] === 'ssh' ? (url[2] ?? '').replace(/:\d+$/, '') : (url?.[2] ?? '')))
  const path = scp?.[2] ?? url?.[3]
  return host !== '' && path !== undefined && path !== '' ? { host, path } : null
}
