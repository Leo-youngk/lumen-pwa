/**
 * Local mock of the Lumen Worker.
 *
 * The real API lives in a Cloudflare Worker that needs KV, R2, and provider
 * credentials. This server implements the same six routes so the frontend can
 * be developed and reviewed end to end without deploying anything.
 *
 * Run: node mock/server.mjs  (listens on 8787; Vite proxies /api to it)
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.MOCK_PORT || 8787)
const TOKEN = process.env.MOCK_TOKEN || 'local-test-only'

const conversations = new Map()
const sessions = new Set()

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const MODELS = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', family: 'DeepSeek', context_length: 1_000_000 },
  { id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash', family: 'DeepSeek', context_length: 1_000_000 },
  { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', family: 'Google', context_length: 1_048_576 },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', family: 'Anthropic', context_length: 200_000 },
  { id: 'kimi-k3', name: 'Kimi K3', family: 'Moonshot', context_length: 262_144 },
]

function cookies(request) {
  const header = request.headers.get('cookie') || ''
  return Object.fromEntries(
    header
      .split(';')
      .map(part => part.trim().split('='))
      .filter(pair => pair.length === 2),
  )
}

async function authenticated(request) {
  if (process.env.MOCK_AUTO_AUTH === '1') return true
  const sid = cookies(request).lumen_session
  return sid ? sessions.has(sid) : false
}

const MATH_ANSWER = [
  '杜邦公式把 ROE 拆成三块：',
  '',
  '$$\\text{ROE} = \\frac{\\text{净利润}}{\\text{股东权益}} = \\frac{\\text{净利润}}{\\text{销售收入}} \\times \\frac{\\text{销售收入}}{\\text{总资产}} \\times \\frac{\\text{总资产}}{\\text{股东权益}}$$',
  '',
  '其中杠杆倍数那一项是 $\\frac{\\text{总资产}}{\\text{股东权益}}$，行内也能写 $a^2 + b^2 = c^2$。',
  '',
  '- 利润率：卖得多贵',
  '- 周转率：卖得多快',
  '- 杠杆：借了多少钱',
].join('\n')

/** Rough answer text so the streaming path has something to push. */
function answerFor(question) {
  if (/公式|数学|math|ROE|杠杆|杜邦/i.test(question)) return MATH_ANSWER
  const intro = question.trim() || '你的问题'
  const body = [
    `关于**${intro.slice(0, 40)}**，可以分三层来看：`,
    '',
    '1. 先确定这件事的边界——你要解决的是哪一类问题；',
    '2. 再看约束条件，时间、成本、可逆性各占多少权重；',
    '3. 最后才谈方案，因为方案是约束的函数。',
    '',
    '> 判断标准比结论更重要，因为结论会过期，标准不会。',
    '',
    '如果需要，我可以把这三点展开成一份具体的执行清单。',
  ]
  return body.join('\n')
}

async function handleChat(request) {
  let payload = {}
  try {
    payload = await request.json()
  } catch {
    return json({ error: '请求体不是有效 JSON。' }, 400)
  }

  const question = payload.question || [...(payload.messages ?? [])].reverse().find(m => m.role === 'user')?.content || ''
  const answer = answerFor(question)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = event => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      // Thinking tokens arrive first, as they do on a real reasoning model.
      for (const chunk of ['先理清问题的边界，', '再确认约束条件。']) {
        send({ type: 'reasoning', text: chunk })
        await sleep(180)
      }
      // Stream visible text in small pieces so the caret behaves realistically.
      for (let index = 0; index < answer.length; index += 6) {
        send({ type: 'text', text: answer.slice(index, index + 6) })
        await sleep(22)
      }
      send({ type: 'usage', input: 640 + question.length, output: answer.length, total: 640 + question.length + answer.length })
      send({ type: 'done' })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
    duplex: 'half',
  })

  let response
  try {
    if (url.pathname === '/api/auth') {
      if (req.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        if (body.token === TOKEN) {
          const sid = randomUUID()
          sessions.add(sid)
          response = json({ ok: true }, 200, {
            'Set-Cookie': `lumen_session=${sid}; Path=/; HttpOnly; SameSite=Lax`,
          })
        } else {
          response = json({ error: '访问令牌不正确。' }, 401)
        }
      } else {
        response = json({ authenticated: await authenticated(request) })
      }
    } else if (url.pathname === '/api/health') {
      response = json({ ok: true, provider: 'mock', model: 'deepseek-v4-pro' })
    } else if (url.pathname === '/api/models') {
      response = (await authenticated(request)) ? json({ data: MODELS }) : json({ error: '需要先登录。' }, 401)
    } else if (url.pathname === '/api/chat') {
      response = (await authenticated(request)) ? await handleChat(request) : json({ error: '需要先登录。' }, 401)
    } else if (url.pathname === '/api/conversations') {
      if (!(await authenticated(request))) response = json({ error: '需要先登录。' }, 401)
      else if (req.method === 'PUT') {
        const body = await request.json().catch(() => ({}))
        conversations.set('default', body)
        response = json({ ok: true })
      } else {
        response = json(conversations.get('default') ?? { conversations: [] })
      }
    } else {
      response = json({ error: 'API 路径不存在。' }, 404)
    }
  } catch (failure) {
    response = json({ error: String(failure?.message ?? failure) }, 500)
  }

  res.writeHead(response.status, Object.fromEntries(response.headers))
  if (response.body) {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
  }
  res.end()
})

server.listen(PORT, () => {
  console.log(`[mock] Lumen API on http://localhost:${PORT}  (token: ${TOKEN})`)
})
