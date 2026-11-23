import assert from 'node:assert/strict'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { bookContext } from '../client/features.js'
import worker from '../worker/index.mjs'

const origin = 'http://localhost'
const env = {
  APP_ACCESS_TOKEN: 'local-test-only',
  OPENCODE_GO_API_KEY: 'upstream-test-only',
}

async function sessionHeaders() {
  const request = new Request(origin + '/api/auth', {
    method: 'POST',
    body: JSON.stringify({ token: env.APP_ACCESS_TOKEN }),
  })
  const response = await worker.fetch(request, env)
  assert.equal(response.status, 200)
  return { Cookie: response.headers.get('set-cookie').split(';')[0] }
}

test('EPUB returns complete Markdown chapters in spine order', async () => {
  const epub = zipSync(Object.fromEntries(Object.entries({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
    'book.opf': '<package><metadata><title>Fixture</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
    'one.xhtml': '<html><body><h1>第一章</h1><p>首章线索</p></body></html>',
    'two.xhtml': '<html><body><h1>第二章</h1><p>全书末尾线索</p></body></html>',
  }).map(([path, data]) => [path, strToU8(data)])))
  const response = await worker.fetch(new Request(origin + '/api/epub', {
    method: 'POST',
    body: epub,
    headers: { ...await sessionHeaders(), 'Content-Type': 'application/epub+zip' },
  }), env)
  assert.equal(response.status, 200)
  const book = await response.json()
  assert.deepEqual(book.chapters.map(chapter => chapter.title), ['第一章', '第二章'])
  assert.match(book.chapters[1].text, /全书末尾线索/)
})

test('whole-book analysis sends the start and end of long books, and single-chapter analysis stays scoped', async () => {
  const progress = []
  const batches = []
  const markers = ['首章标记', '中篇标记', '终章标记']
  const chapters = markers.map((marker, index) => ({
    title: 'Chapter ' + (index + 1),
    text: '正文。'.repeat(3_000) + marker,
  }))
  const options = {
    meta: { title: 'Fixture' }, chapters, question: 'Find the markers', history: '',
    knownContext: 16_384, maxOutput: 2_048,
    signal: new AbortController().signal,
    progress: update => progress.push(update),
    callModel: async (_question, request) => {
      batches.push(request.system)
      return markers.filter(marker => request.system.includes(marker)).join('、') || '本段无标记'
    },
  }
  const result = await bookContext(options)
  assert.ok(batches.length > 1)
  assert.deepEqual(progress.at(-1), { done: batches.length, total: batches.length, stage: 'read' })
  for (const marker of markers) {
    assert.ok(batches.some(batch => batch.includes(marker)))
    assert.ok(result.system.includes(marker))
  }
  batches.length = 0
  const selected = await bookContext({ ...options, focus: 1, knownContext: 64_000 })
  assert.deepEqual(selected.selected, [1])
  assert.match(selected.system, /中篇标记/)
  assert.doesNotMatch(selected.system, /首章标记|终章标记/)
  assert.equal(batches.length, 0)
})

test('Worker distinguishes successful completion from EOF after partial text and retains usage', async t => {
  let upstreamFrames
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return new Response(upstreamFrames)
  })

  const headers = {
    ...await sessionHeaders(),
    'X-Api-Base': 'https://models.example.com/v1',
    'X-Api-Key': 'fixture-client-key',
  }
  async function chat(frames) {
    upstreamFrames = frames
    const response = await worker.fetch(new Request(origin + '/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({
        system: '第 2 章 · 全书末尾线索',
        messages: [{ role: 'user', content: '测试问题' }],
      }),
    }), env)
    assert.equal(response.status, 200)
    return (await response.text()).trim().split('\n\n')
      .map(frame => JSON.parse(frame.slice(6)))
  }

  const partial = 'data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n'
  const usage = 'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n'
  const incomplete = await chat(partial + usage)
  assert.deepEqual(incomplete.map(event => event.type), ['text', 'usage', 'error', 'done'])
  assert.equal(incomplete[1].total, 10)
  const complete = await chat(partial + usage + 'data: [DONE]\n\n')
  assert.deepEqual(complete.map(event => event.type), ['text', 'usage', 'done'])
  assert.equal(calls[0].url, 'https://models.example.com/v1/chat/completions')
  assert.match(calls[0].body.messages[0].content, /全书末尾线索/)
})
