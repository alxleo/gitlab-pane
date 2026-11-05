import type { Pinned } from '../types'

const MR_URL = /^https:\/\/gitlab\.com\/(.+?)\/-\/merge_requests\/(\d+)/

export const MR_URLS = /https:\/\/gitlab\.com\/[\w.\-/]+?\/-\/merge_requests\/\d+/g

export function parseMrUrl(url: string): Pinned | null {
  const match = MR_URL.exec(url.trim())
  if (match?.[1] === undefined || match[2] === undefined) {
    return null
  }
  const iid = Number(match[2])
  return { url: `https://gitlab.com/${match[1]}/-/merge_requests/${iid}`, project: match[1], iid }
}

export const pinKey = (pin: Pinned): string => `${pin.project}!${pin.iid}`
