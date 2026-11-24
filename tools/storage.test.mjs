import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['src/lib/store.ts'], bundle: true, format: 'esm', platform: 'node', write: false })
const { loadConversations, restoreConversations, saveConversations } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'),
)

test('a failed database save survives reload, including deletions, and clears after recovery', async t => {
  const storage = new Map()
  let writeFails = false
  let localFails = false
  let snapshot = []
  function replaceGlobal(name, value) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous)
      else delete globalThis[name]
    })
  }
  replaceGlobal('localStorage', {
    getItem: key => storage.get(key) ?? null,
    setItem(key, value) {
      if (localFails) throw new DOMException('quota', 'QuotaExceededError')
      storage.set(key, value)
    },
    removeItem: key => storage.delete(key),
  })
  replaceGlobal('indexedDB', {
    open() {
      const request = { result: {
        close() {},
        transaction(_store, mode) {
          const transaction = {
            objectStore: () => ({
              get: () => ({ result: structuredClone(snapshot) }),
              put(records) {
                if (!writeFails) snapshot = structuredClone(records)
                return {}
              },
            }),
          }
          queueMicrotask(() => {
            if (mode === 'readwrite' && writeFails) transaction.onabort()
            else transaction.oncomplete()
          })
          return transaction
        },
      } }
      queueMicrotask(() => request.onsuccess())
      return request
    },
  })
  t.mock.method(console, 'warn', () => {})
  const before = [{ id: 'conversation', updatedAt: 1, messages: [{ role: 'user', content: 'before' }] }]
  const after = [{ ...before[0], messages: [...before[0].messages, { role: 'assistant', content: 'latest streamed reply', incomplete: true }] }]
  await saveConversations(before)
  writeFails = true
  await saveConversations(after)
  assert.deepEqual(loadConversations(), after)
  assert.deepEqual(await restoreConversations(), after)
  // A pending empty history must not resurrect old database conversations.
  await saveConversations([])
  assert.deepEqual(await restoreConversations(), [])
  writeFails = false
  await saveConversations(after)
  assert.equal(storage.size, 0)
  assert.deepEqual(await restoreConversations(), after)
  writeFails = true
  localFails = true
  await assert.rejects(saveConversations(after), /尚未保存/)
})
