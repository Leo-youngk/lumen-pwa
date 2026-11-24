import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ApiError, LumenClient, type ModelOption } from '@/lib/api'
import { clearChatDraft } from '@/hooks/useChatDraft'
import { resolveOutputLimit } from '@/lib/modelLimits'
import { continuationQuestion, continuationWriter } from '@/lib/continuation'
import { bookContext, type ReadingProgress } from '../../client/features.js'
import { retryModel } from '../../client/retry-model.js'
import {
  DEFAULT_SETTINGS,
  KEYS,
  getBook,
  isPinned,
  loadConversations,
  loadModel,
  loadSettings,
  loadSyncCode,
  loadUsage,
  newId,
  recordUsage,
  restoreConversations,
  saveConversations,
  saveModel,
  saveSettings,
  type Conversation,
  type Message,
  type Settings,
  type UsageState,
  type UsageReport,
} from '@/lib/store'

type Status = 'checking' | 'authenticated' | 'unauthenticated' | 'unavailable'

export type ModelStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string }

interface LumenContextValue {
  status: Status
  retrySession: () => void
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  connectProvider: (apiBaseUrl: string, apiKey: string) => Promise<void>
  resetSettings: () => void

  models: ModelOption[]
  modelStatus: ModelStatus
  refreshModels: () => void
  model: string
  setModel: (id: string) => void
  modelLabel: (id: string) => string

  conversations: Conversation[]
  activeId: string | null
  active: Conversation | null
  openConversation: (id: string | null) => void
  startConversation: (seed: Partial<Conversation>, open: boolean) => void
  updateConversation: (id: string, patch: Partial<Conversation>) => void
  deleteConversation: (id: string) => void
  togglePin: (id: string) => void
  clearAll: () => void
  storageError: string | null

  streaming: boolean
  streamingId: string | null
  readingProgress: ReadingProgress | null
  error: string | null
  clearError: () => void
  send: (text: string, quote?: string) => Promise<void>
  stop: () => void
  retry: () => Promise<void>
  continueAnswer: () => Promise<void>

  usage: UsageState

  signIn: (token: string) => Promise<string | null>
  syncCode: string
  setSyncCode: (code: string) => void
}

const LumenContext = createContext<LumenContextValue | null>(null)

function providerHeaders(settings: Pick<Settings, 'apiBaseUrl' | 'apiKey'>): Record<string, string> {
  const headers: Record<string, string> = {}
  if (settings.apiKey?.trim()) headers['X-Api-Key'] = settings.apiKey.trim()
  if (settings.apiBaseUrl?.trim()) headers['X-Api-Base'] = settings.apiBaseUrl.trim()
  return headers
}

export function useLumen(): LumenContextValue {
  const value = useContext(LumenContext)
  if (!value) throw new Error('useLumen must be used inside <LumenProvider>')
  return value
}

/**
 * Build a conversation record. Kept outside the provider because `send` needs
 * the finished object back synchronously: `startConversation` only schedules a
 * state update, and the refs that mirror state are not refreshed until the
 * next render, so reading them back immediately would find nothing.
 */
function makeConversation(seed: Partial<Conversation> = {}, fallbackModel = ''): Conversation {
  const now = Date.now()
  return {
    id: seed.id ?? newId(),
    title: seed.title ?? '新对话',
    model: seed.model ?? fallbackModel,
    messages: seed.messages ?? [],
    book: seed.book,
    createdAt: seed.createdAt ?? now,
    updatedAt: seed.updatedAt ?? now,
  }
}

function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return '新对话'
  return clean.length > 28 ? `${clean.slice(0, 28)}…` : clean
}

function modelContent(message: Message): string {
  if (!message.quote) return message.content
  return `我选中的上一条回答片段：\n${message.quote}\n\n我的追问：\n${message.content}`
}

export function LumenProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')
  const [sessionAttempt, setSessionAttempt] = useState(0)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations)
  const [historyReady, setHistoryReady] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: 'loading' })
  const [modelRefresh, setModelRefresh] = useState(0)
  const [model, setModelState] = useState<string>(() => loadModel() || DEFAULT_SETTINGS.defaultModel)
  const [streaming, setStreaming] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [readingProgress, setReadingProgress] = useState<ReadingProgress | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const [usage, setUsage] = useState<UsageState>(loadUsage)
  const [syncCode, setSyncCodeState] = useState<string>(loadSyncCode)
  const [storageError, setStorageError] = useState<string | null>(null)

  // Refs mirror state so the streaming callbacks and the client header hook
  // read the newest values without being re-created (which would restart the
  // model fetch on every keystroke in Settings).
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const modelRef = useRef(model)
  modelRef.current = model
  const abortRef = useRef<AbortController | null>(null)
  const bookNotes = useRef<{ key: string; notes: Map<string, string>; forceBatches: boolean } | null>(null)
  const client = useMemo(
    () => new LumenClient('', { headers: () => providerHeaders(settingsRef.current) }),
    [],
  )

  /* ------------------------------------------------------------ bootstrap */

  useEffect(() => {
    let cancelled = false
    restoreConversations()
      .then(history => { if (!cancelled) setConversations(history) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setHistoryReady(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12_000)
    client
      .session(controller.signal)
      .then(authenticated => {
        if (!cancelled) setStatus(authenticated ? 'authenticated' : 'unauthenticated')
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable')
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [client, sessionAttempt])

  useEffect(() => {
    if (status !== 'authenticated') return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)])
    setModelStatus({ state: 'loading' })
    client
      .models(signal)
      .then(list => {
        if (controller.signal.aborted) return
        setModels(list)
        setModelStatus({ state: 'ready' })
        if (list.length && !list.some(item => item.id === modelRef.current)) {
          const preferred = list.find(item => item.id === settingsRef.current.defaultModel) ?? list[0]
          if (preferred) {
            setModelState(preferred.id)
            saveModel(preferred.id)
          }
        }
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) setStatus('unauthenticated')
        setModelStatus({
          state: 'error',
          message: signal.aborted ? '连接模型列表超时，请稍后重试。'
            : failure instanceof Error ? failure.message : '模型列表获取失败。',
        })
      })
    return () => controller.abort()
  }, [client, status, settings.apiBaseUrl, settings.apiKey, modelRefresh])

  /* -------------------------------------------------------------- persist */

  const persistHistory = useCallback((history: Conversation[]) => {
    void saveConversations(history).then(
      () => setStorageError(null),
      (failure: unknown) => setStorageError(failure instanceof Error ? failure.message : '对话尚未保存，请保持页面打开。'),
    )
  }, [])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    if (!historyReady || !streaming) return
    const timer = window.setInterval(() => persistHistory(conversationsRef.current), 1_000)
    return () => window.clearInterval(timer)
  }, [historyReady, streaming, persistHistory])

  useEffect(() => {
    if (historyReady && !streaming) persistHistory(conversations)
  }, [conversations, historyReady, streaming, persistHistory])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(current => ({ ...current, ...patch }))
  }, [])

  const connectProvider = useCallback(async (apiBaseUrl: string, apiKey: string) => {
    const config = { apiBaseUrl, apiKey }
    const probe = new LumenClient('', { headers: () => providerHeaders(config) })
    const list = await probe.models(AbortSignal.timeout?.(12_000))
    if (!list.length) throw new Error('接口没有返回可选模型。')
    setModels(list)
    setModelStatus({ state: 'ready' })
    updateSettings(config)
  }, [updateSettings])

  const resetSettings = useCallback(() => {
    setSettings(current => ({
      ...DEFAULT_SETTINGS,
      // Appearance resets should not wipe the person's own provider setup.
      apiBaseUrl: current.apiBaseUrl,
      apiKey: current.apiKey,
      reasoningByModel: current.reasoningByModel,
      outputTokenLimit: current.outputTokenLimit,
    }))
  }, [])

  const setModel = useCallback((id: string) => {
    setModelState(id)
    saveModel(id)
    const target = activeIdRef.current
    if (target) {
      setConversations(current =>
        current.map(item =>
          item.id === target ? { ...item, model: id, updatedAt: Date.now() } : item,
        ),
      )
    }
  }, [])

  const modelLabel = useCallback(
    (id: string) => models.find(item => item.id === id)?.name ?? id,
    [models],
  )

  /* -------------------------------------------------------- conversations */

  const active = useMemo(
    () => conversations.find(item => item.id === activeId) ?? null,
    [conversations, activeId],
  )

  const openConversation = useCallback((id: string | null) => {
    activeIdRef.current = id
    setActiveId(id)
  }, [])

  const startConversation = useCallback((seed: Partial<Conversation>, open: boolean) => {
    const conversation = makeConversation(seed, modelRef.current)
    setConversations(current => [conversation, ...current])
    if (open) openConversation(conversation.id)
  }, [openConversation])

  const updateConversation = useCallback((id: string, patch: Partial<Conversation>) => {
    setConversations(current =>
      current.map(item => (item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item)),
    )
  }, [])

  const deleteConversation = useCallback((id: string) => {
    if (streamingId === id) abortRef.current?.abort()
    setConversations(current => current.filter(item => item.id !== id))
    clearChatDraft(id)
    if (activeIdRef.current === id) openConversation(null)
  }, [openConversation, streamingId])

  const togglePin = useCallback((id: string) => {
    setConversations(current =>
      current.map(item => (item.id === id ? { ...item, pinned: !isPinned(item) } : item)),
    )
  }, [])

  const clearAll = useCallback(() => {
    abortRef.current?.abort()
    bookNotes.current = null
    setConversations([])
    clearChatDraft()
    openConversation(null)
  }, [openConversation])

  /* --------------------------------------------------------------- stream */

  const appendToAnswer = useCallback(
    (conversationId: string, messageId: string, field: 'content' | 'reasoning', chunk: string) => {
      setConversations(current =>
        current.map(item =>
          item.id !== conversationId
            ? item
            : {
                ...item,
                messages: item.messages.map(message =>
                  message.id !== messageId
                    ? message
                    : { ...message, [field]: (message[field] ?? '') + chunk },
                ),
              },
        ),
      )
    },
    [],
  )

  const run = useCallback(
    async (conversation: Conversation, user: Message, replaceId?: string, resume = false) => {
      if (abortRef.current) return

      const conversationId = conversation.id
      const question = modelContent(user)
      const selectedModel = models.find(option => option.id === conversation.model)
        ?? models.find(option => option.id === modelRef.current) ?? models[0]
      const selectedId = selectedModel?.id ?? conversation.model
      const currentSettings = settingsRef.current
      const config = providerHeaders(currentSettings)
      const savedEffort = currentSettings.reasoningByModel?.[selectedId]
      const effort = selectedModel?.reasoningOptions.find(option => option === savedEffort)
      const readingEffort = selectedModel?.reasoningOptions.find(option => option === 'none')
      const requestedOutput = resolveOutputLimit(selectedModel, currentSettings.outputTokenLimit)
      const requestClient = new LumenClient('', { headers: () => config })
      const controller = new AbortController()
      abortRef.current = controller
      setStreaming(true)
      setStreamingId(conversationId)
      setError(null)

      const previousAnswer = conversation.messages.find(message => message.id === replaceId)
      const continuing = resume && previousAnswer?.incomplete && Boolean(previousAnswer.content.trim())
      const answer: Message = continuing && previousAnswer ? previousAnswer : {
        id: newId(),
        role: 'assistant',
        content: '',
        incomplete: true,
        createdAt: Date.now(),
      }
      const answerId = answer.id
      setConversations(current =>
        current.map(item =>
          item.id === conversationId
            ? {
                ...item,
                model: selectedId,
                messages: [...item.messages.filter(message => message.id !== replaceId), answer],
                updatedAt: Date.now(),
              }
            : item,
        ),
      )

      let answerStarted = false
      let receivedAnswer = false
      const chat = async (body: Record<string, unknown>, signal: AbortSignal, streamAnswer: boolean) => {
        let report: UsageReport | null = null
        let output = ''
        let reasoning = ''
        let frame: number | undefined
        let flushTimer: number | undefined
        function flush() {
          if (frame !== undefined) cancelAnimationFrame(frame)
          window.clearTimeout(flushTimer)
          frame = undefined
          flushTimer = undefined
          if (output) appendToAnswer(conversationId, answerId, 'content', output)
          if (reasoning) appendToAnswer(conversationId, answerId, 'reasoning', reasoning)
          output = ''
          reasoning = ''
        }
        function scheduleFlush() {
          frame ??= requestAnimationFrame(flush)
          flushTimer ??= window.setTimeout(flush, 200)
        }
        function appendText(text: string) {
          output += text
          if (streamAnswer) {
            receivedAnswer ||= Boolean(text.trim())
            scheduleFlush()
          }
        }
        const continuation = streamAnswer && continuing ? continuationWriter(answer.content, appendText) : undefined

        try {
          await requestClient.chat({
            ...body, model: selectedId, session_id: conversationId,
            provider_protocol: selectedModel?.protocol,
            reasoning_effort: streamAnswer ? effort : readingEffort,
          }, event => {
            if (event.type === 'usage') {
              const input = event.input ?? 0
              const outputTokens = event.output ?? 0
              report = { input, output: outputTokens, total: event.total ?? input + outputTokens }
            } else if (event.type === 'text') {
              if (streamAnswer && !answerStarted) {
                answerStarted = true
                setReadingProgress(null)
              }
              if (continuation) continuation.push(event.text)
              else appendText(event.text)
            } else if (streamAnswer && event.type === 'reasoning') {
              reasoning += event.text
              scheduleFlush()
            }
          }, signal)
          return output
        } finally {
          continuation?.finish()
          if (streamAnswer) flush()
          setUsage(recordUsage(report))
        }
      }

      try {
        const messages = conversation.messages
          .filter(item => item.id !== replaceId && !item.incomplete && item.content.trim())
          .map(item => ({
            role: item.role,
            content: continuing && item.id === user.id
              ? continuationQuestion(question, answer.content, selectedModel?.contextTokens) : modelContent(item),
            reasoning_content: item.reasoning,
          }))
        const modelLimit = selectedModel?.outputTokens ?? Infinity
        let maxOutput = requestedOutput === undefined ? undefined : Math.min(requestedOutput, modelLimit)
        const writeAnswer = async (system?: string, splitInsteadOfRetry?: (failure: unknown) => boolean) => {
          setReadingProgress({ stage: 'answer', done: 0, total: 0 })
          await retryModel(
            () => {
              answerStarted = false
              return chat({ messages, system, max_tokens: maxOutput }, controller.signal, true)
            },
            controller.signal,
            {
              canRetry: failure => !answerStarted && !splitInsteadOfRetry?.(failure),
              onRetry: () => setReadingProgress({ stage: 'retry', done: 0, total: 0 }),
            },
          )
          if (!receivedAnswer) {
            throw new Error(continuing ? '模型没有续写出新的正文，已保留原回答。' : '模型没有返回可阅读的正文。')
          }
        }
        const bookRecord = conversation.book
        if (bookRecord) {
          const book = await getBook(bookRecord)
          if (!book) throw new Error('本设备没有这本书的正文，请重新上传 EPUB。')
          const context = selectedModel?.contextTokens
          const window = context ?? 16_384
          const history = messages.map(item => item.content + (item.reasoning_content ?? '')).join('\n')
          const available = Math.floor(window * .9) - new TextEncoder().encode(history).length - 1500
          const readingLimit = available - Math.max(3000, Math.min(48_000, Math.floor(available / 2)))
          if (readingLimit < 16) throw new Error('上下文空间不足，请清理对话历史或选择上下文更大的模型。')
          const bookOutput = Math.min(maxOutput ?? 8_192, modelLimit, readingLimit)
          maxOutput = bookOutput
          const key = JSON.stringify([
            conversationId, user.id, book.meta.id, bookRecord.focusChapter ?? null,
            selectedId, selectedModel?.protocol, context, modelLimit, readingEffort, config,
          ])
          if (bookNotes.current?.key !== key) {
            bookNotes.current = { key, notes: new Map(), forceBatches: false }
          }
          const reading = bookNotes.current
          const prepareBook = () => bookContext({
            meta: book.meta,
            chapters: book.chapters,
            focus: bookRecord.focusChapter,
            question,
            history,
            knownContext: context,
            maxOutput: bookOutput,
            modelOutput: selectedModel?.outputTokens,
            progress: setReadingProgress,
            signal: controller.signal,
            notesCache: reading.notes,
            forceBatches: reading.forceBatches,
            parallelism: /(?:^|-)free$/i.test(selectedId) ? 1 : 2,
            callModel: (prompt, options, signal) => chat({
              system: options.system,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: options.maxTokens,
            }, signal, false),
          })
          const selection = await prepareBook()
          const shouldSplit = (failure: unknown) => !answerStarted && selection.mode === 'direct'
            && failure instanceof ApiError
            && (failure.code === 'context_limit' || (selection.system.length > 32_000
              && (failure.code === 'upstream_timeout' || failure.code === 'upstream_interrupted')))
          try {
            await writeAnswer(selection.system, shouldSplit)
          } catch (failure) {
            if (!shouldSplit(failure)) throw failure
            reading.forceBatches = true
            const reduced = await prepareBook()
            await writeAnswer(reduced.system)
          }
        } else {
          if (maxOutput !== undefined && selectedModel?.contextTokens) {
            const encoder = new TextEncoder()
            const input = messages.reduce((total, message) =>
              total + encoder.encode(message.content + (message.reasoning_content ?? '')).length + 12, 1024)
            maxOutput = Math.min(maxOutput, selectedModel.contextTokens - input)
            if (maxOutput < 16) throw new Error('对话历史占用了模型的上下文，请新建对话后重试。')
          }
          await writeAnswer()
        }
        setConversations(current => current.map(item => item.id !== conversationId ? item : {
          ...item,
          messages: item.messages.map(message => message.id === answerId ? { ...message, incomplete: false } : message),
        }))
      } catch (failure) {
        const cause = failure instanceof Error && failure.cause instanceof ApiError ? failure.cause : failure
        if (cause instanceof ApiError && cause.status === 401) setStatus('unauthenticated')
        if (!controller.signal.aborted) {
          setError({ id: conversationId, message:
            (failure instanceof Error
              ? failure.message
              : '请求失败。') + (previousAnswer && !previousAnswer.incomplete
              ? ' 已保留上一次的完整回答。'
              : receivedAnswer || continuing ? ' 已保留已生成的正文。' : ''),
          })
        }
        setConversations(current => current.map(item => item.id !== conversationId ? item : {
          ...item,
          messages: previousAnswer && !continuing && (!previousAnswer.incomplete || !receivedAnswer)
            ? item.messages.map(message => message.id === answerId ? previousAnswer : message)
            : item.messages.filter(message => message.id !== answerId || message.content.trim()),
        }))
      } finally {
        abortRef.current = null
        setReadingProgress(null)
        setStreamingId(null)
        setStreaming(false)
      }
    },
    [appendToAnswer, models],
  )

  const send = useCallback(
    async (text: string, quote?: string) => {
      const trimmed = text.trim()
      if (!trimmed || abortRef.current) return

      const userMessage: Message = {
        id: newId(),
        role: 'user',
        content: trimmed,
        quote,
        createdAt: Date.now(),
      }

      const existing = activeIdRef.current
        ? conversationsRef.current.find(item => item.id === activeIdRef.current)
        : undefined

      // First message in a fresh conversation: the record has to exist before
      // streaming starts, and it cannot be read back out of state yet, so it is
      // built here and inserted in the same update that carries the message.
      const conversation: Conversation = existing
        ? {
            ...existing,
            title: existing.messages.length ? existing.title : deriveTitle(trimmed),
            messages: [...existing.messages, userMessage],
            updatedAt: Date.now(),
          }
        : {
            ...makeConversation({ model: modelRef.current }, modelRef.current),
            title: deriveTitle(trimmed),
            messages: [userMessage],
          }

      conversationsRef.current = existing
        ? conversationsRef.current.map(item => (item.id === conversation.id ? conversation : item))
        : [conversation, ...conversationsRef.current]
      setConversations(conversationsRef.current)
      openConversation(conversation.id)

      await run(conversation, userMessage)
    },
    [openConversation, run],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const repeatAnswer = useCallback(async (resume: boolean) => {
    const conversation = conversationsRef.current.find(item => item.id === activeIdRef.current)
    if (!conversation) return
    const lastUser = [...conversation.messages].reverse().find(item => item.role === 'user')
    if (!lastUser) return
    const last = conversation.messages.at(-1)
    if (resume && (last?.role !== 'assistant' || !last.incomplete || !last.content.trim())) return
    await run(conversation, lastUser, last?.role === 'assistant' ? last.id : undefined, resume)
  }, [run])
  const retry = useCallback(() => repeatAnswer(false), [repeatAnswer])
  const continueAnswer = useCallback(() => repeatAnswer(true), [repeatAnswer])

  /* ----------------------------------------------------------------- auth */

  const signIn = useCallback(
    async (token: string) => {
      try {
        await client.signIn(token)
        setStatus('authenticated')
        return null
      } catch (failure) {
        return failure instanceof Error ? failure.message : '登录失败。'
      }
    },
    [client],
  )

  const setSyncCode = useCallback((code: string) => {
    setSyncCodeState(code)
    if (code) localStorage.setItem(KEYS.syncCode, code)
    else localStorage.removeItem(KEYS.syncCode)
  }, [])

  const value: LumenContextValue = {
    status: historyReady ? status : 'checking',
    retrySession: useCallback(() => {
      setStatus('checking')
      setSessionAttempt(attempt => attempt + 1)
    }, []),
    settings,
    updateSettings,
    connectProvider,
    resetSettings,
    models,
    modelStatus,
    refreshModels: useCallback(() => setModelRefresh(n => n + 1), []),
    model,
    setModel,
    modelLabel,
    conversations,
    activeId,
    active,
    openConversation,
    startConversation,
    updateConversation,
    deleteConversation,
    togglePin,
    clearAll,
    storageError,
    streaming,
    streamingId,
    readingProgress,
    error: error?.id === activeId ? error.message : null,
    clearError: useCallback(() => setError(null), []),
    send,
    stop,
    retry,
    continueAnswer,
    usage,
    signIn,
    syncCode,
    setSyncCode,
  }

  return <LumenContext.Provider value={value}>{children}</LumenContext.Provider>
}
