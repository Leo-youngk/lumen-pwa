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
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  defaultModel: 'deepseek-v4-pro',
  apiBaseUrl: '',
  apiKey: '',
  fontSize: 15,
  lineHeight: 1.75,
  paragraphSpacing: 16,
  compactMode: false,
  enterToSend: true,
}

export interface BookRecord {
  id: string
  title: string
  author?: string
  chapterCount: number
  charCount: number
  unreadable?: number
  markdown?: string
  focusChapter?: number | null
  cover?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  createdAt: number
}

export interface Conversation {
  id: string
  title: string
  model: string
  messages: Message[]
  book?: BookRecord
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
  return { ...DEFAULT_SETTINGS, ...stored }
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
  const stored = readJson<Conversation[]>(KEYS.conversations, [])
  if (!Array.isArray(stored)) return []
  return stored
    .filter((item): item is Conversation => Boolean(item?.id && item?.messages))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveConversations(conversations: Conversation[]): void {
  writeJson(KEYS.conversations, conversations)
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
const DB_NAME = 'lumen-kv'
const DB_VERSION = 1
const BOOK_STORE = 'books'
const CHAPTER_STORE = 'chapters'

interface StoredBook {
  id: string
  meta: BookRecord
}
interface StoredChapters {
  id: string
  chapters: string[]
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
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
  store: string,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = run(transaction.objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

export async function putBook(meta: BookRecord, chapters: string[]): Promise<void> {
  await Promise.all([
    tx(BOOK_STORE, 'readwrite', store => store.put({ id: meta.id, meta })),
    tx(CHAPTER_STORE, 'readwrite', store => store.put({ id: meta.id, chapters })),
  ])
}

export async function getBook(
  id: string,
): Promise<{ meta: BookRecord; chapters: string[] } | null> {
  const [storedBook, storedChapters] = await Promise.all([
    tx<StoredBook | undefined>(BOOK_STORE, 'readonly', store => store.get(id)),
    tx<StoredChapters | undefined>(CHAPTER_STORE, 'readonly', store => store.get(id)),
  ])
  if (!storedBook?.meta || !storedChapters?.chapters?.length) return null
  return { meta: storedBook.meta, chapters: storedChapters.chapters }
}

export async function deleteBook(id: string): Promise<void> {
  await Promise.all([
    tx(BOOK_STORE, 'readwrite', store => store.delete(id)),
    tx(CHAPTER_STORE, 'readwrite', store => store.delete(id)),
  ])
}
