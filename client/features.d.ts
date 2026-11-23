import type { Chapter } from '../src/lib/store'

export interface ReadingProgress {
  done: number
  total: number
  stage: 'direct' | 'read' | 'merge'
}

export function bookContext(options: {
  meta: { title: string; unreadable?: number; missingSections?: string[] }
  chapters: Chapter[]
  focus?: number | null
  question: string
  history: string
  knownContext?: number
  modelOutput?: number
  maxOutput: number
  callModel: (question: string, options: { system: string; maxTokens: number }, signal: AbortSignal) => Promise<string>
  progress?: (value: ReadingProgress) => void
  signal: AbortSignal
}): Promise<{ system: string; selected: number[] }>
