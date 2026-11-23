export function providerRoute(baseUrl, model) {
  const base = new URL(baseUrl)
  if (base.hostname !== 'opencode.ai' || !base.pathname.startsWith('/zen/go/')) return '/chat/completions'
  const id = model.toLowerCase()
  if (/^(gpt-|grok-)/.test(id)) return '/responses'
  if (/^(minimax-|qwen)/.test(id)) return '/messages'
  return '/chat/completions'
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
