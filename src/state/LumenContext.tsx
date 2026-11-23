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
import { bookContext, type ReadingProgress } from '../../client/features.js'
import {
  DEFAULT_SETTINGS,
  KEYS,
  getBook,
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

type Status = 'checking' | 'authenticated' | 'unauthenticated'

export type ModelStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string }

interface LumenContextValue {
  status: Status
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
  openConversation: (id: string) => void
  startConversation: (seed?: Partial<Conversation>) => string
  updateConversation: (id: string, patch: Partial<Conversation>) => void
  deleteConversation: (id: string) => void
  toggleStar: (id: string) => void
  clearAll: () => void

  streaming: boolean
  streamingId: string | null
  readingProgress: ReadingProgress | null
  error: string | null
  clearError: () => void
  send: (text: string) => Promise<void>
  stop: () => void
  retry: () => Promise<void>

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

export function LumenProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')
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
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageState>(loadUsage)
  const [syncCode, setSyncCodeState] = useState<string>(loadSyncCode)

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
    client
      .session()
      .then(authenticated => {
        if (!cancelled) setStatus(authenticated ? 'authenticated' : 'unauthenticated')
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated')
      })
    return () => {
      cancelled = true
    }
  }, [client])

  useEffect(() => {
    if (status !== 'authenticated') return
    const controller = new AbortController()
    setModelStatus({ state: 'loading' })
    client
      .models(controller.signal)
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
        setModelStatus({
          state: 'error',
          message: failure instanceof Error ? failure.message : '模型列表获取失败。',
        })
      })
    return () => controller.abort()
  }, [client, status, settings.apiBaseUrl, settings.apiKey, modelRefresh])

  /* -------------------------------------------------------------- persist */

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    if (!historyReady || !streaming) return
    const timer = window.setInterval(() => { void saveConversations(conversationsRef.current) }, 1_000)
    return () => window.clearInterval(timer)
  }, [historyReady, streaming])

  useEffect(() => {
    if (historyReady && !streaming) void saveConversations(conversations)
  }, [conversations, historyReady, streaming])

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

  const openConversation = useCallback((id: string) => {
    setActiveId(id)
    setError(null)
  }, [])

  const startConversation = useCallback((seed?: Partial<Conversation>) => {
    const conversation = makeConversation(seed, modelRef.current)
    setConversations(current => [conversation, ...current])
    setActiveId(conversation.id)
    setError(null)
    return conversation.id
  }, [])

  const updateConversation = useCallback((id: string, patch: Partial<Conversation>) => {
    setConversations(current =>
      current.map(item => (item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item)),
    )
  }, [])

  const deleteConversation = useCallback((id: string) => {
    if (streamingId === id) abortRef.current?.abort()
    setConversations(current => current.filter(item => item.id !== id))
    if (activeIdRef.current === id) setActiveId(null)
  }, [streamingId])

  const toggleStar = useCallback((id: string) => {
    setConversations(current =>
      current.map(item => (item.id === id ? { ...item, starred: !item.starred } : item)),
    )
  }, [])

  const clearAll = useCallback(() => {
    abortRef.current?.abort()
    setConversations([])
    setActiveId(null)
  }, [])

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
    async (conversation: Conversation, question: string, replaceId?: string) => {
      if (abortRef.current) return

      const conversationId = conversation.id
      const selectedModel = models.find(option => option.id === conversation.model)
        ?? models.find(option => option.id === modelRef.current) ?? models[0]
      const selectedId = selectedModel?.id ?? conversation.model
      const currentSettings = settingsRef.current
      const config = providerHeaders(currentSettings)
      const savedEffort = currentSettings.reasoningByModel?.[selectedId]
      const effort = selectedModel?.reasoningOptions.find(option => option === savedEffort)
      const requestedOutput = currentSettings.outputTokenLimit === 'max'
        ? selectedModel?.outputTokens
        : currentSettings.outputTokenLimit ?? undefined
      const requestClient = new LumenClient('', { headers: () => config })
      const controller = new AbortController()
      abortRef.current = controller
      setStreaming(true)
      setStreamingId(conversationId)
      setError(null)

      const answerId = newId()
      const answer: Message = {
        id: answerId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      }
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

      const chat = async (body: Record<string, unknown>, signal: AbortSignal, streamAnswer: boolean) => {
        let report: UsageReport | null = null
        let output = ''
        let reasoning = ''
        let frame: number | undefined
        function flush() {
          if (frame !== undefined) cancelAnimationFrame(frame)
          frame = undefined
          if (output) appendToAnswer(conversationId, answerId, 'content', output)
          if (reasoning) appendToAnswer(conversationId, answerId, 'reasoning', reasoning)
          output = ''
          reasoning = ''
        }

        try {
          await requestClient.chat({
            ...body, model: selectedId, session_id: conversationId,
            provider_protocol: selectedModel?.protocol,
            reasoning_effort: streamAnswer ? effort : undefined,
          }, event => {
            if (event.type === 'usage') {
              const input = event.input ?? 0
              const outputTokens = event.output ?? 0
              report = { input, output: outputTokens, total: event.total ?? input + outputTokens }
            } else if (event.type === 'text') {
              output += event.text
              if (streamAnswer) {
                setReadingProgress(null)
                frame ??= requestAnimationFrame(flush)
              }
            } else if (streamAnswer && event.type === 'reasoning') {
              reasoning += event.text
              frame ??= requestAnimationFrame(flush)
            }
          }, signal)
          return output
        } finally {
          if (streamAnswer) flush()
          setUsage(recordUsage(report))
        }
      }

      try {
        const messages = conversation.messages
          .filter(item => item.id !== replaceId && !item.incomplete && item.content.trim())
          .map(item => ({ role: item.role, content: item.content, reasoning_content: item.reasoning }))
        let system: string | undefined
        const modelLimit = selectedModel?.outputTokens ?? Infinity
        let maxOutput = requestedOutput === undefined ? undefined : Math.min(requestedOutput, modelLimit)
        if (conversation.book) {
          const book = await getBook(conversation.book)
          if (!book) throw new Error('本设备没有这本书的正文，请重新上传 EPUB。')
          const context = selectedModel?.contextTokens
          const readingLimit = Math.floor((context ?? 16_384) / 4)
          maxOutput = Math.min(maxOutput ?? 8_192, modelLimit, readingLimit)
          const selection = await bookContext({
            meta: book.meta,
            chapters: book.chapters,
            focus: conversation.book.focusChapter,
            question,
            history: messages.map(item => item.content + (item.reasoning_content ?? '')).join('\n'),
            knownContext: context,
            maxOutput,
            progress: setReadingProgress,
            signal: controller.signal,
            callModel: (prompt, options, signal) => chat({
              system: options.system,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: options.maxTokens,
            }, signal, false),
          })
          system = selection.system
        } else if (maxOutput !== undefined && selectedModel?.contextTokens) {
          const encoder = new TextEncoder()
          const input = messages.reduce((total, message) =>
            total + encoder.encode(message.content + (message.reasoning_content ?? '')).length + 12, 1024)
          maxOutput = Math.min(maxOutput, selectedModel.contextTokens - input)
          if (maxOutput < 16) throw new Error('对话历史占用了模型的上下文，请新建对话后重试。')
        }
        await chat({ messages, system, max_tokens: maxOutput }, controller.signal, true)
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof ApiError || failure instanceof Error
              ? failure.message
              : '请求失败。',
          )
        }
        setConversations(current => current.map(item => item.id !== conversationId ? item : {
          ...item,
          messages: item.messages
            .filter(message => message.id !== answerId || message.content.trim())
            .map(message => message.id === answerId ? { ...message, incomplete: true } : message),
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
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || abortRef.current) return

      const userMessage: Message = {
        id: newId(),
        role: 'user',
        content: trimmed,
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
      setActiveId(conversation.id)

      await run(conversation, trimmed)
    },
    [run],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const retry = useCallback(async () => {
    const conversation = conversationsRef.current.find(item => item.id === activeIdRef.current)
    if (!conversation) return
    const lastUser = [...conversation.messages].reverse().find(item => item.role === 'user')
    if (!lastUser) return
    const last = conversation.messages.at(-1)
    await run(conversation, lastUser.content, last?.incomplete ? last.id : undefined)
  }, [run])

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
    toggleStar,
    clearAll,
    streaming,
    streamingId,
    readingProgress,
    error,
    clearError: useCallback(() => setError(null), []),
    send,
    stop,
    retry,
    usage,
    signIn,
    syncCode,
    setSyncCode,
  }

  return <LumenContext.Provider value={value}>{children}</LumenContext.Provider>
}
