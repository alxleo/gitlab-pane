import { bareHost, cardKey } from './hosts.ts'

import type { Pinned } from '../types'

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A host list as a regex alternation; the longest first, so `a.com:8443` is not cut at `a.com`. */
const alternation = (hosts: readonly string[]): string =>
  [...hosts]
    .sort((a, b) => b.length - a.length)
    .map(escaped)
    .join('|')

/** Every merge request URL on one of `hosts` in a text. */
export const mrUrls = (hosts: readonly string[]): RegExp => new RegExp(`https://(?:${alternation(hosts)})/[\\w.\\-/]+?/-/merge_requests/\\d+`, 'gi')

/** The MR a URL on one of `hosts` names, or null for any other address. */
export function parseMrUrl(url: string, hosts: readonly string[]): Pinned | null {
  const match = new RegExp(`^https://(${alternation(hosts)})/(.+?)/-/merge_requests/(\\d+)`, 'i').exec(url.trim())
  const host = bareHost(match?.[1] ?? '')
  const path = match?.[2]
  if (host === '' || path === undefined || match?.[3] === undefined) {
    return null
  }
  const iid = Number(match[3])
  return { url: `https://${host}/${path}/-/merge_requests/${iid}`, host, path, iid }
}

export const pinKey = (pin: Pinned): string => cardKey(pin.host, pin.path, pin.iid)
