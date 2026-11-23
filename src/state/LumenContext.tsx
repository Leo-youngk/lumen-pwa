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
import {
  DEFAULT_SETTINGS,
  KEYS,
  loadConversations,
  loadModel,
  loadSettings,
  loadSyncCode,
  loadUsage,
  newId,
  recordUsage,
  saveConversations,
  saveModel,
  saveSettings,
  type Conversation,
  type Message,
  type Settings,
  type UsageState,
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
  const [activeId, setActiveId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: 'loading' })
  const [modelRefresh, setModelRefresh] = useState(0)
  const [model, setModelState] = useState<string>(() => loadModel() || DEFAULT_SETTINGS.defaultModel)
  const [streaming, setStreaming] = useState(false)
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
  const streamingRef = useRef(false)
  streamingRef.current = streaming

  const client = useMemo(
    () =>
      new LumenClient('', {
        headers: (): Record<string, string> => {
          const key = settingsRef.current.apiKey.trim()
          const headers: Record<string, string> = {}
          if (key) headers['X-Api-Key'] = key
          return headers
        },
      }),
    [],
  )

  /* ------------------------------------------------------------ bootstrap */

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
    saveConversations(conversations)
  }, [conversations])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(current => ({ ...current, ...patch }))
  }, [])

  const resetSettings = useCallback(() => {
    setSettings(current => ({
      ...DEFAULT_SETTINGS,
      // Appearance resets should not wipe the person's own provider setup.
      apiBaseUrl: current.apiBaseUrl,
      apiKey: current.apiKey,
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
    setConversations(current => current.filter(item => item.id !== id))
    if (activeIdRef.current === id) setActiveId(null)
  }, [])

  const toggleStar = useCallback((id: string) => {
    setConversations(current =>
      current.map(item => (item.id === id ? { ...item, starred: !item.starred } : item)),
    )
  }, [])

  const clearAll = useCallback(() => {
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
    async (conversationId: string, question: string) => {
      const conversation = conversationsRef.current.find(item => item.id === conversationId)
      if (!conversation) return

      const controller = new AbortController()
      abortRef.current = controller
      setStreaming(true)
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
            ? { ...item, messages: [...item.messages, answer], updatedAt: Date.now() }
            : item,
        ),
      )

      // A mutable box rather than a `let`: assignments inside the stream
      // callback are invisible to TypeScript's control-flow narrowing, which
      // would collapse the variable to `null` at every later read.
      const reported: { current: { input?: number; output?: number; total?: number } | null } = {
        current: null,
      }

      try {
        await client.chat(
          {
            model: conversation.model,
            messages: conversation.messages
              .filter(item => item.content.trim())
              .map(item => ({ role: item.role, content: item.content })),
            book: conversation.book,
            question,
          },
          event => {
            if (event.type === 'usage') {
              reported.current = { input: event.input, output: event.output, total: event.total }
            } else if (event.type === 'text') {
              appendToAnswer(conversationId, answerId, 'content', event.text)
            } else if (event.type === 'reasoning') {
              appendToAnswer(conversationId, answerId, 'reasoning', event.text)
            }
          },
          controller.signal,
        )
        const usage = reported.current
        setUsage(
          recordUsage(
            usage
              ? {
                  input: usage.input ?? 0,
                  output: usage.output ?? 0,
                  total: usage.total ?? (usage.input ?? 0) + (usage.output ?? 0),
                }
              : null,
          ),
        )
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof ApiError || failure instanceof Error
              ? failure.message
              : '请求失败。',
          )
          setConversations(current =>
            current.map(item =>
              item.id !== conversationId
                ? item
                : {
                    ...item,
                    messages: item.messages.filter(
                      message => message.id !== answerId || message.content.trim(),
                    ),
                  },
            ),
          )
        }
        // A cancelled answer keeps the text that already streamed in.
      } finally {
        abortRef.current = null
        setStreaming(false)
      }
    },
    [appendToAnswer, client],
  )

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || streamingRef.current) return

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

      await run(conversation.id, trimmed)
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
    await run(conversation.id, lastUser.content)
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
    status,
    settings,
    updateSettings,
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
    streamingId: streaming ? activeId : null,
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
