import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import worker from '../worker/index.mjs'
import { providerReasoningParams } from '../worker/provider.mjs'
import { continuationWriter } from '../src/lib/continuation.ts'
import { retryModel } from '../client/retry-model.js'

const compiled = await build({
  entryPoints: ['src/lib/api.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
})
const { LumenClient } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const env = { APP_ACCESS_TOKEN: 'chat-test-only', OPENCODE_GO_API_KEY: 'provider-test-only' }
const frame = data => 'data: ' + JSON.stringify(data) + '\n\n'

async function loginHeaders() {
  const response = await worker.fetch(new Request('https://test.local/api/auth', {
    method: 'POST',
    body: JSON.stringify({ token: env.APP_ACCESS_TOKEN }),
  }), env)
  return { Cookie: response.headers.get('set-cookie').split(';')[0] }
}

async function send(headers, payload, signal) {
  return worker.fetch(new Request('https://test.local/api/chat', {
    method: 'POST', headers, body: JSON.stringify(payload), signal,
  }), env)
}

const question = { messages: [{ role: 'user', content: '测试' }] }
const chunks = source => new ReadableStream({
  start(controller) {
    const bytes = new TextEncoder().encode(source)
    for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3))
    controller.close()
  },
})
const settle = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve()
}

test('client parses CRLF, multiline frames, fragmented UTF-8 and an unterminated last event', async t => {
  const source = '\uFEFF: ping\r\ndata: {"type":"text",\r\ndata: "text":"中文🙂"}\r\n\r\ndata: {"type":"done"}'
  t.mock.method(globalThis, 'fetch', async () => new Response(chunks(source)))
  const events = []
  await new LumenClient().chat(question, event => events.push(event))
  assert.deepEqual(events, [{ type: 'text', text: '中文🙂' }, { type: 'done' }])
})

test('client stops at done without waiting for EOF and cancels the reader', async t => {
  let canceled = false
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(frame({ type: 'done' }))) },
    cancel() { canceled = true },
  })
  t.mock.method(globalThis, 'fetch', async () => new Response(body))
  await new LumenClient().chat(question, () => {})
  assert.equal(canceled, true)
})

test('client reports malformed frames and keeps server error codes and usage', async t => {
  let source = 'data: {"type":"text","text":"partial"}\n\ndata: {broken}\n\n' + frame({ type: 'done' })
  t.mock.method(globalThis, 'fetch', async () => new Response(source))
  await assert.rejects(new LumenClient().chat(question, () => {}), /格式异常/)
  source = frame({ type: 'usage', input: 10, output: 2, total: 12 })
    + frame({ type: 'error', error: 'output stopped', code: 'output_limit' }) + frame({ type: 'done' })
  const events = []
  await assert.rejects(new LumenClient().chat(question, event => events.push(event)), { code: 'output_limit' })
  assert.equal(events[0].total, 12)
  source = frame({ type: 'text', text: 'partial' })
  await assert.rejects(new LumenClient().chat(question, () => {}), /未完整返回/)
})

test('model catalog honors recommended protocol and filters duplicate and invalid IDs', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [
    { id: 'multi', api: { responses: {}, 'chat-completions': {} }, recommended_api: 'responses',
      capabilities: { reasoning: { supported: true, effort: ['heavy', 'high'] } } },
    { id: 'multi' }, { id: 123 }, { id: 'embedding', type: 'embedding' },
  ] }))
  const models = await new LumenClient().models()
  assert.equal(models.length, 1)
  assert.equal(models[0].protocol, 'responses')
  assert.deepEqual(models[0].reasoningOptions, ['heavy', 'high'])
  assert.deepEqual(providerReasoningParams('/responses', 'heavy', 4096), { reasoning: { effort: 'heavy' } })
})

test('Worker accepts multiline and CRLF upstream events without losing the final chunk', async t => {
  const headers = await loginHeaders()
  t.mock.method(globalThis, 'fetch', async () => new Response(chunks(
    '\uFEFFdata: {"choices":[\r\ndata: {"delta":{"content":"中文🙂"}}]}\r\n\r\ndata: [DONE]',
  )))
  const response = await send(headers, question)
  const body = await response.text()
  assert.match(body, /中文🙂/)
  assert.doesNotMatch(body, /"type":"error"/)
})

test('Worker rejects malformed JSON objects before calling a provider', async () => {
  const headers = await loginHeaders()
  for (const value of [null, [], 1]) {
    const auth = await worker.fetch(new Request('https://test.local/api/auth', {
      method: 'POST', body: JSON.stringify(value),
    }), env)
    assert.equal(auth.status, 400)
    assert.equal((await send(headers, value)).status, 400)
  }
})

test('Worker reports filtered and tool-call endings as incomplete answers', async t => {
  const headers = await loginHeaders()
  let ending = 'content_filter'
  t.mock.method(globalThis, 'fetch', async () => new Response(
    frame({ choices: [{ delta: { content: 'partial' }, finish_reason: ending }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }) + 'data: [DONE]\n\n',
  ))
  for (const reason of ['content_filter', 'tool_calls']) {
    ending = reason
    const body = await (await send(headers, question)).text()
    assert.match(body, /"type":"error"/)
    assert.match(body, /"total":13/)
  }
})

test('Messages API tool pauses and context exhaustion are not saved as completed replies', async t => {
  const headers = await loginHeaders()
  let ending
  t.mock.method(globalThis, 'fetch', async () => new Response(
    frame({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } })
      + frame({ type: 'message_delta', delta: { stop_reason: ending } })
      + frame({ type: 'message_stop' }),
  ))
  for (const reason of ['tool_use', 'pause_turn', 'model_context_window_exceeded']) {
    ending = reason
    const body = await (await send(headers, { ...question, provider_protocol: 'messages' })).text()
    assert.match(body, /"type":"error"/)
    if (reason === 'model_context_window_exceeded') assert.match(body, /"code":"output_limit"/)
  }
})

test('Worker propagates cancellation before upstream response headers arrive', async t => {
  const headers = await loginHeaders()
  const connected = Promise.withResolvers()
  const interrupted = Promise.withResolvers()
  let upstreamSignal
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    upstreamSignal = options.signal
    options.signal.addEventListener('abort', () => interrupted.reject(options.signal.reason), { once: true })
    connected.resolve()
    return interrupted.promise
  })
  const abort = new AbortController()
  const pending = send(headers, question, abort.signal)
  await connected.promise
  const body = assert.rejects((await pending).text(), { name: 'AbortError' })
  abort.abort()
  assert.equal(upstreamSignal.aborted, true)
  await body
})

test('Worker connection timeout covers a provider that never sends headers', async t => {
  const headers = await loginHeaders()
  const connected = Promise.withResolvers()
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    connected.resolve()
  }))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const body = (await send(headers, question)).text()
  await connected.promise
  t.mock.timers.tick(150_000)
  assert.match(await body, /"code":"upstream_timeout","status":504/)
})

test('Worker sends keepalives before model headers and allows a long gap between chunks', async t => {
  const headers = await loginHeaders()
  const pending = Promise.withResolvers()
  let source
  t.mock.method(globalThis, 'fetch', () => pending.promise)
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() })
  const response = await send(headers, { ...question, system: 'This request includes a book.' })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const next = async () => decoder.decode((await reader.read()).value)
  assert.match(await next(), /^: connected/)
  async function wait() {
    for (let index = 0; index < 6; index++) {
      const ping = next()
      await settle()
      t.mock.timers.tick(12_000)
      assert.match(await ping, /^: keepalive/)
    }
  }
  await wait()
  const encoder = new TextEncoder()
  pending.resolve(new Response(new ReadableStream({
    start(controller) {
      source = controller
      controller.enqueue(encoder.encode(frame({ choices: [{ delta: { content: 'First part' } }] })))
    },
  })))
  assert.match(await next(), /First part/)
  await wait()
  source.enqueue(encoder.encode(frame({ choices: [{ delta: { content: 'End' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'))
  source.close()
  assert.match(await next(), /"text":"End"/)
  assert.match(await next(), /"type":"done"/)
})

test('rate limits retain the upstream retry delay', async t => {
  const headers = await loginHeaders()
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'too many requests' }, {
    status: 429, headers: { 'Retry-After': '30' },
  }))
  const response = await send(headers, question)
  const body = await response.text()
  assert.match(body, /"code":"rate_limit","status":429,"retryAfterMs":30000/)
  t.mock.method(globalThis, 'fetch', async () => new Response(body))
  await assert.rejects(new LumenClient().chat(question, () => {}), { status: 429, code: 'rate_limit', retryAfterMs: 30_000 })
})

test('a continuation appends new text and removes a repeated tail across deltas', () => {
  const end = '这一段已经完整生成。'
  let answer = '章节一。' + end
  const append = continuationWriter(answer, text => { answer += text })
  append.push('这一段已经')
  append.push('完整生成。')
  append.push('\n\n## 第二章')
  append.finish()
  assert.equal(answer, '章节一。' + end + '\n\n## 第二章')
})

test('transient failures retry once and a stopped request never restarts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const controller = new AbortController()
  const task = async () => {
    if (++calls === 1) throw Object.assign(new Error('temporary'), { code: 'upstream_interrupted' })
    return 'finished'
  }
  const pending = retryModel(task, controller.signal)
  await settle()
  t.mock.timers.tick(650)
  assert.equal(await pending, 'finished')
  calls = 0
  const aborted = assert.rejects(retryModel(task, controller.signal), { name: 'AbortError' })
  await settle()
  controller.abort()
  await aborted
  t.mock.timers.tick(650)
  assert.equal(calls, 1)
})

test('canceling a downstream reader aborts a quiet upstream stream', async t => {
  const headers = await loginHeaders()
  let source
  let upstreamSignal
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    upstreamSignal = options.signal
    return new Response(new ReadableStream({
      start(controller) {
        source = controller
        controller.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { content: 'partial' } }] })))
      },
    }))
  })
  t.after(() => { try { source.error(new Error('test cleanup')) } catch {} })
  const reader = (await send(headers, question)).body.getReader()
  await reader.read()
  await reader.read()
  await reader.cancel()
  await settle()
  assert.equal(upstreamSignal.aborted, true)
})

test('heartbeat comments do not extend the content idle timeout forever', async t => {
  const headers = await loginHeaders()
  let source
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      source = controller
      controller.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { content: 'partial' } }] })))
    },
  })))
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  const body = (await send(headers, question)).text()
  await settle()
  t.mock.timers.tick(90_000)
  source.enqueue(new TextEncoder().encode(': ping\n\n'))
  await settle()
  t.mock.timers.tick(31_000)
  assert.match(await body, /"code":"upstream_timeout"/)
})

test('deployment enables real incoming Request.signal cancellation', async () => {
  const config = await readFile('wrangler.example.jsonc', 'utf8')
  assert.match(config, /"enable_request_signal"/)
})
