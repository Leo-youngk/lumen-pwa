/**
 * Persistence.
 *
 * The key names and record shapes here are a compatibility contract: the
 * previous build of this app wrote them, and a person's conversation history
 * lives in them. Renaming anything would silently orphan existing libraries,
 * so treat every string in `KEYS` and every field below as fixed.
 */

export const KEYS = {
  conversations: 'lumen.conversations.v1',
  model: 'lumen.model.v1',
  settings: 'lumen.settings.v1',
  settingsBackup: 'lumen.settings.backup.v1',
  syncCode: 'lumen.syncCode',
  deleted: 'lumen.deleted.v1',
  deviceId: 'lumen.deviceId',
} as const

export type ThemeName = 'light' | 'dark' | 'mono' | 'cream'

export interface Settings {
  theme: ThemeName
  /** Explicit dark-mode toggle for the `system` default. */
  defaultModel: string
  apiBaseUrl: string
  apiKey: string
  /** Chat typography, kept because it is stored per device. */
  fontSize: number
  lineHeight: number
  paragraphSpacing: number
  compactMode: boolean
  enterToSend: boolean
  reasoningByModel: Record<string, string>
  outputTokenLimit: number | 'max' | 'auto'
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  defaultModel: 'deepseek-v4-pro',
  apiBaseUrl: '',
  apiKey: '',
  fontSize: 16,
  lineHeight: 1.65,
  paragraphSpacing: 16,
  compactMode: false,
  enterToSend: true,
  reasoningByModel: {},
  outputTokenLimit: 130_000,
}

export interface BookRecord {
  id: string
  title: string
  author?: string
  chapterCount: number
  charCount: number
  unreadable?: number
  missingSections?: string[]
  markdown?: string
  focusChapter?: number | null
  cover?: string
}

export interface Chapter {
  title: string
  text: string
  source?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  quote?: string
  reasoning?: string
  incomplete?: boolean
  createdAt: number
}

export interface Conversation {
  id: string
  title: string
  model: string
  messages: Message[]
  book?: BookRecord
  pinned?: boolean
  starred?: boolean
  updatedAt: number
  createdAt: number
}

export interface UsageReport {
  input: number
  output: number
  total: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exhaustion must not break the session; the in-memory state stays
    // correct and the next save may succeed once older records are pruned.
  }
}

/* ------------------------------------------------------------- device + id */

export function deviceId(): string {
  let id = localStorage.getItem(KEYS.deviceId)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(KEYS.deviceId, id)
  }
  return id
}

export function newId(): string {
  return crypto.randomUUID()
}

/* ---------------------------------------------------------------- settings */

export function loadSettings(): Settings {
  const stored = readJson<Partial<Settings>>(KEYS.settings, {})
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    outputTokenLimit: stored.outputTokenLimit ?? DEFAULT_SETTINGS.outputTokenLimit,
  }
}

export function saveSettings(settings: Settings): void {
  writeJson(KEYS.settings, settings)
  writeJson(KEYS.settingsBackup, settings)
}

export function loadBackupSettings(): Partial<Settings> | null {
  return readJson<Partial<Settings> | null>(KEYS.settingsBackup, null)
}

/* ------------------------------------------------------------------ models */

export function loadModel(): string {
  return localStorage.getItem(KEYS.model) ?? ''
}

export function saveModel(model: string): void {
  localStorage.setItem(KEYS.model, model)
}

/* ----------------------------------------------------------- conversations */

export function loadConversations(): Conversation[] {
  return validConversations(readJson(KEYS.conversations, []))
}

export function isPinned(conversation: Conversation): boolean {
  return conversation.pinned ?? conversation.starred ?? false
}

export function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) =>
    Number(isPinned(b)) - Number(isPinned(a)) || b.updatedAt - a.updatedAt,
  )
}

function validConversations(stored: unknown): Conversation[] {
  if (!Array.isArray(stored)) return []
  return stored.filter((item): item is Conversation => Boolean(item?.id && Array.isArray(item.messages)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function restoreConversations(): Promise<Conversation[]> {
  const db = await openDb()
  const current = await tx(db, 'kv', 'readonly', store => store.get('conversations-v2'))
  if (Array.isArray(current)) return validConversations(current)

  const legacy = await readExisting('lumen-kv', 'kv', 'conversations')
  const deleted = new Set(loadDeleted())
  const merged = new Map<string, Conversation>()
  for (const item of [...validConversations(legacy), ...loadConversations()]) {
    const previous = merged.get(item.id)
    if (!deleted.has(item.id) && (!previous || item.updatedAt >= previous.updatedAt)) merged.set(item.id, item)
  }
  return validConversations([...merged.values()])
}

export async function saveConversations(conversations: Conversation[]): Promise<void> {
  try {
    const db = await openDb()
    await tx(db, 'kv', 'readwrite', store => store.put(conversations, 'conversations-v2'))
  } catch {
    writeJson(KEYS.conversations, conversations)
  }
}

export function loadDeleted(): string[] {
  const stored = readJson<string[]>(KEYS.deleted, [])
  return Array.isArray(stored) ? stored : []
}

export function saveDeleted(ids: string[]): void {
  writeJson(KEYS.deleted, ids)
}

/* ------------------------------------------------------------- sync + sync */

export function loadSyncCode(): string {
  return localStorage.getItem(KEYS.syncCode) ?? ''
}

export function saveSyncCode(code: string): void {
  if (code) localStorage.setItem(KEYS.syncCode, code)
  else localStorage.removeItem(KEYS.syncCode)
}

/* ------------------------------------------------------------------ usage */

const usageKey = 'lumen.usage.v1'

export interface UsageState extends UsageReport {
  unreported: number
}

export function loadUsage(): UsageState {
  return readJson<UsageState>(usageKey, { input: 0, output: 0, total: 0, unreported: 0 })
}

export function recordUsage(report: UsageReport | null): UsageState {
  const current = loadUsage()
  const next: UsageState = report
    ? {
        input: current.input + (report.input || 0),
        output: current.output + (report.output || 0),
        total: current.total + (report.total || report.input + report.output || 0),
        unreported: current.unreported,
      }
    : { ...current, unreported: current.unreported + 1 }
  writeJson(usageKey, next)
  return next
}

/* ------------------------------------------------------------------- books */

/**
 * Books live in IndexedDB rather than localStorage because a converted book
 * can exceed the 4 MiB string limit that localStorage enforces.
 */
const DB_NAME = 'lumen-reading-v2'
const DB_VERSION = 1
const BOOK_STORE = 'books'
const CHAPTER_STORE = 'chapters'

interface StoredBook {
  id: string
  meta: BookRecord
}
interface StoredChapters {
  id: string
  chapters: (Chapter | string)[]
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains(BOOK_STORE)) {
        db.createObjectStore(BOOK_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(CHAPTER_STORE)) {
        db.createObjectStore(CHAPTER_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const request = run(transaction.objectStore(store))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = () => reject(transaction.error ?? request.error)
  })
}

export async function putBook(meta: BookRecord, chapters: Chapter[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([BOOK_STORE, CHAPTER_STORE], 'readwrite')
    transaction.objectStore(BOOK_STORE).put({ id: meta.id, meta })
    transaction.objectStore(CHAPTER_STORE).put({ id: meta.id, chapters })
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
  })
}

function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    let missing = false
    request.onupgradeneeded = () => {
      missing = true
      request.transaction?.abort()
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => missing ? resolve(null) : reject(request.error)
  })
}

async function readExisting<T>(name: string, storeName: string, key: string): Promise<T | undefined> {
  const db = await openExisting(name)
  if (!db) return undefined
  try {
    return db.objectStoreNames.contains(storeName)
      ? await tx<T | undefined>(db, storeName, 'readonly', store => store.get(key))
      : undefined
  } finally {
    db.close()
  }
}

export async function getBook(book: BookRecord): Promise<{ meta: BookRecord; chapters: Chapter[] } | null> {
  const { id } = book
  const db = await openDb()
  const [storedBook, storedChapters] = await Promise.all([
    tx<StoredBook | undefined>(db, BOOK_STORE, 'readonly', store => store.get(id)),
    tx<StoredChapters | undefined>(db, CHAPTER_STORE, 'readonly', store => store.get(id)),
  ])
  const toChapters = (entries: (Chapter | string)[]) => entries.map((chapter, index) =>
    typeof chapter === 'string' ? { title: `第 ${index + 1} 章`, text: chapter } : chapter,
  )
  if (storedBook?.meta && storedChapters?.chapters?.length) {
    return { meta: storedBook.meta, chapters: toChapters(storedChapters.chapters) }
  }

  const legacy = await readExisting<StoredChapters>('lumen-books', 'books', id)
    ?? await readExisting<StoredChapters>('lumen-kv', CHAPTER_STORE, id)
  let chapters = legacy?.chapters?.length ? toChapters(legacy.chapters) : undefined
  if (!chapters?.length && typeof book.markdown === 'string' && book.markdown.trim()) {
    chapters = [{ title: book.title, text: book.markdown }]
  }
  if (!chapters?.length) return null
  const meta = { ...book, markdown: undefined, chapterCount: chapters.length }
  await putBook(meta, chapters)
  return { meta, chapters }
}
