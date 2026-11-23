const goOrigin = 'https://opencode.ai'
export const goBaseUrl = `${goOrigin}/inference/go`

export function isOpenCodeGo(baseUrl) {
  const parsed = new URL(baseUrl)
  return parsed.origin === goOrigin && /^\/(?:zen\/go\/v1|inference\/go)(?:\/|$)/.test(parsed.pathname)
}

export function providerRoute(baseUrl, model) {
  if (!isOpenCodeGo(baseUrl)) return '/chat/completions'
  const id = model.toLowerCase()
  if (/^(gpt-|grok-)/.test(id)) return '/responses'
  if (/^(claude-|minimax-|qwen)/.test(id)) return '/messages'
  return '/chat/completions'
}

export function providerModelsUrl(baseUrl) {
  return isOpenCodeGo(baseUrl) ? `${goBaseUrl}/v1/models` : `${baseUrl}/models`
}

export function providerChatUrl(baseUrl, endpoint) {
  if (!isOpenCodeGo(baseUrl)) return `${baseUrl}${endpoint}`
  const api = endpoint === '/messages' ? 'anthropic' : 'openai'
  return `${goBaseUrl}/${api}/v1${endpoint}`
}

export function providerSessionHeaders(baseUrl, sessionId) {
  if (!isOpenCodeGo(baseUrl)) return {}
  const id = typeof sessionId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(sessionId)
    ? sessionId : crypto.randomUUID()
  return { 'x-opencode-session': `ses_${id}`, 'User-Agent': 'Lumen-PWA/1.0' }
}

export function parseProviderUsage(event, seen) {
  const usage = event.response?.usage ?? event.message?.usage ?? event.usage
  if (!usage || typeof usage !== 'object') return seen
  const input = numeric(usage.input_tokens ?? usage.prompt_tokens)
  const output = numeric(usage.output_tokens ?? usage.completion_tokens)
  const total = numeric(usage.total_tokens)
  if (input === undefined && output === undefined && total === undefined) return seen
  const cached = (numeric(usage.cache_read_input_tokens) ?? 0) + (numeric(usage.cache_creation_input_tokens) ?? 0)
  return {
    input: input === undefined ? seen?.input : input + cached,
    output: output ?? seen?.output,
    total: total ?? seen?.total,
  }
}

const numeric = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined

export function usageEvent(usage) {
  if (!usage) return null
  const input = usage.input ?? 0
  const output = usage.output ?? 0
  return { type: 'usage', input, output, total: usage.total ?? input + output }
}
