import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import worker from '../built/worker.mjs'

const upstream = globalThis.fetch
const db = new Map()
const markers = ['首章蓝鲸标记', '中篇代号草稿纸', '终章火星标记']
let seen = new Set()

function stream(objects) {
  return new Response(objects.map(object => 'data: ' + JSON.stringify(object) + '\n\n').join(''))
}

globalThis.fetch = async (url, options) => {
  if (typeof url !== 'string' || !/^https:\/\/(opencode.ai|models.example.com)\//.test(url)) return upstream(url, options)
  if (url.includes('models.example.com') && options.headers.Authorization !== 'Bearer sample-client-key') {
    return new Response('invalid key', { status: 401 })
  }
  if (url.endsWith('/models')) return Response.json({ data: url.includes('models.example.com')
    ? [{ id: 'custom-model', name: 'Custom Test Model', context_length: 64000 }]
    : [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', context_length: 30000 },
      { id: 'gpt-6-luna', name: 'GPT 6 Luna', context_length: 64000 },
      { id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus', context_length: 64000 },
    ] })
  const body = JSON.parse(options.body)
  const context = body.instructions ?? body.system ?? body.messages?.find(message => message.role === 'system')?.content ?? ''
  const question = body.messages?.findLast(message => message.role === 'user')?.content || body.input?.findLast(message => message.role === 'user')?.content
  let result = '已收到：' + question + '\n\n**流式回答**'
  if (context.includes('这一批正文')) {
    const found = markers.filter(marker => context.includes(marker))
    found.forEach(marker => seen.add(marker))
    result = '本批证据：' + found.join('、')
  } else if (context.includes('逐段读完')) {
    result = '全书证据：' + markers.filter(marker => context.includes(marker)).join('、')
    if (seen.size !== markers.length) result += '（覆盖不足）'
    seen = new Set()
  } else if (context.includes('【第')) {
    result = '完整章节：' + markers.filter(marker => context.includes(marker)).join('、')
  } else if (question?.startsWith('请根据下面的对话内容')) {
    result = '测试对话'
  }
  if (url.endsWith('/responses')) return stream([
    { type: 'response.output_text.delta', delta: result },
    { type: 'response.completed', response: { usage: { input_tokens: 27, output_tokens: 16, total_tokens: 43 } } },
  ])
  if (url.endsWith('/messages')) return stream([
    { type: 'message_start', message: { usage: { input_tokens: 27 } } },
    { type: 'content_block_delta', delta: { text: result } },
    { type: 'message_delta', usage: { output_tokens: 16 } },
    { type: 'message_stop' },
  ])
  return stream([
    { choices: [{ delta: { content: result } }] },
    { choices: [], usage: { prompt_tokens: 27, completion_tokens: 16, total_tokens: 43 } },
  ])
}

const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' }
const env = {
  APP_ACCESS_TOKEN: 'local-test-only',
  OPENCODE_GO_API_KEY: 'local-upstream-only',
  OPENCODE_GO_MODEL: 'deepseek-v4-pro',
  CONVERSATIONS: { get: key => db.get(key), put: (key, value) => db.set(key, value) },
  ASSETS: { async fetch(request) {
    const path = new URL(request.url).pathname
    const name = path === '/' ? '/index.html' : path
    const type = types[name.split('.').at(-1)] ?? 'application/octet-stream'
    try {
      return new Response(await readFile(new URL('../public' + name, import.meta.url)), { headers: { 'Content-Type': type } })
    } catch { return new Response('Not found', { status: 404 }) }
  } },
}
http.createServer(async (req, res) => {
  try {
    const request = new Request('http://127.0.0.1:4173' + req.url, {
      method: req.method,
      headers: req.headers,
      ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }),
    })
    const out = await worker.fetch(request, env)
    res.writeHead(out.status, Object.fromEntries(out.headers))
    if (!out.body) res.end()
    else Readable.fromWeb(out.body).pipe(res)
  } catch (error) {
    console.error(error)
    if (!res.headersSent) res.writeHead(500)
    res.end('Local harness error')
  }
}).listen(4173, '127.0.0.1', () => console.log('Local Lumen → http://127.0.0.1:4173'))
