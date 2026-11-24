import type { Chapter } from '../src/lib/store'

export interface EpubResult {
  title: string
  author: string
  chapterCount: number
  charCount: number
  unreadable: number
  missingSections: string[]
  chapters: Chapter[]
}

export const maxEpubBytes: number
export class EpubError extends Error {
  readonly status: number
}
export function parseEpub(bytes: Uint8Array, options?: { progress?: (done: number, total: number) => void }): EpubResult
