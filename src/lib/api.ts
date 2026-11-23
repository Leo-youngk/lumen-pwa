import type { Chapter } from './store'

/** Shape returned by `/api/models`. */
export interface ModelOption {
  id: string
  name: string
  family: string
  capacity?: string
  contextTokens?: number
}

interface RawModel {
  id?: string
  name?: string
  family?: string
  context_length?: number
  context_window?: number
  max_context_tokens?: number
  top_provider?: { context_length?: number }
}

/** A single streamed event from `/api/chat`. */
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'usage'; input?: number; output?: number; total?: number }
  | { type: 'done' }
  | { type: 'error'; error: string }

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Turn a context-token count into the compact label the picker shows. */
export function formatCapacity(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return ''
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  return `${Math.round(tokens / 1000)}K`
}

function readContextTokens(raw: RawModel): number | undefined {
  const candidates = [
    raw.context_length,
    raw.context_window,
    raw.max_context_tokens,
    raw.top_provider?.context_length,
  ]
  const value = candidates.find(
    (item): item is number => Number.isSafeInteger(item) && (item ?? 0) > 0,
  )
  return value
}

export interface EpubResult {
  title: string
  author: string
  chapterCount: number
  charCount: number
  unreadable: number
  chapters: Chapter[]
}

export interface ClientOptions {
  /** Extra headers sent with every request. Carries the provider key override. */
  headers: () => Record<string, string>
}

export class LumenClient {
  constructor(
    private readonly origin = '',
    private readonly options: ClientOptions = { headers: () => ({}) },
  ) {}

  private url(path: string): string {
    return `${this.origin}${path}`
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(this.url(path), {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...this.options.headers(),
        ...init.headers,
      },
    })
    if (response.status === 401) {
      throw new ApiError('登录已过期，请重新进入。', 401)
    }
    return response
  }

  async session(): Promise<boolean> {
    const response = await fetch(this.url('/api/auth'), { credentials: 'same-origin' })
    if (!response.ok) return false
    const data = (await response.json()) as { authenticated?: boolean }
    return Boolean(data.authenticated)
  }

  async signIn(token: string): Promise<void> {
    const response = await fetch(this.url('/api/auth'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(data.error ?? '访问令牌不正确。', response.status)
    }
  }

  async models(signal?: AbortSignal): Promise<ModelOption[]> {
    const response = await this.request('/api/models', { signal })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(data.error ?? '模型列表获取失败。', response.status)
    }
    const data = (await response.json()) as { data?: RawModel[] } | RawModel[]
    const list = Array.isArray(data) ? data : (data.data ?? [])
    return list
      .filter((item): item is RawModel & { id: string } => Boolean(item?.id))
      .map(item => {
        const contextTokens = readContextTokens(item)
        return {
          id: item.id,
          name: item.name || item.id,
          family: item.family || '服务端',
          capacity: contextTokens ? formatCapacity(contextTokens) : undefined,
          contextTokens,
        }
      })
  }

  async health(): Promise<{ ok: boolean; provider: string; model: string }> {
    const response = await this.request('/api/health')
    if (!response.ok) throw new ApiError('服务状态不可用。', response.status)
    return response.json()
  }

  /**
   * Stream a reply. `onEvent` fires for every server-sent event; the promise
   * resolves once the stream is closed, and rejects if the server reported an
   * error or the connection dropped mid-answer.
   */
  async chat(
    body: Record<string, unknown>,
    onEvent: (event: ChatEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.request('/api/chat', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      signal,
    })

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      let message = '服务没有响应。'
      try {
        const parsed = JSON.parse(detail) as { error?: string }
        if (parsed.error) message = parsed.error
      } catch {
        if (detail.trim()) message = detail.slice(0, 200)
      }
      throw new ApiError(message, response.status)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completed = false
    let failure: string | null = null

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE frames are separated by a blank line; the tail may be partial.
        let split = buffer.indexOf('\n\n')
        while (split !== -1) {
          const frame = buffer.slice(0, split)
          buffer = buffer.slice(split + 2)
          split = buffer.indexOf('\n\n')

          const payload = frame
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim())
            .join('')
          if (!payload) continue

          let event: ChatEvent
          try {
            event = JSON.parse(payload) as ChatEvent
          } catch {
            continue
          }
          if (event.type === 'done') completed = true
          if (event.type === 'error') failure = event.error
          onEvent(event)
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (failure) throw new ApiError(failure, 200)
    if (!completed) throw new ApiError('连接中断，回答未完整返回。请重试。', 200)
  }

  async conversations<T>(signal?: AbortSignal): Promise<T> {
    const response = await this.request('/api/conversations', { signal })
    if (!response.ok) throw new ApiError('云端对话读取失败。', response.status)
    return response.json()
  }

  async saveConversations(payload: unknown): Promise<void> {
    const response = await this.request('/api/conversations', {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) throw new ApiError('云端同步失败。', response.status)
  }

  async uploadEpub(
    file: File,
    signal?: AbortSignal,
  ): Promise<EpubResult> {
    if (file.size > 16 * 1024 * 1024) throw new Error('EPUB 最大支持 16 MB。')
    const response = await this.request('/api/epub', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/epub+zip' },
      signal: signal ?? AbortSignal.timeout?.(115_000),
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(data.error ?? 'EPUB 解析失败。', response.status)
    }
    const book = (await response.json()) as EpubResult
    if (!Array.isArray(book.chapters) || !book.chapters.length) {
      throw new Error('EPUB 转换后没有可读章节。')
    }
    return book
  }
}
