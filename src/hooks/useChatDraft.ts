import { useState } from 'react'

const prefix = 'lumen.draft.v1.'

interface Draft {
  text: string
  quote: string
}

function loadDraft(scope: string): Draft {
  try {
    const saved = JSON.parse(sessionStorage.getItem(prefix + scope) ?? 'null')
    return {
      text: typeof saved?.text === 'string' ? saved.text : '',
      quote: typeof saved?.quote === 'string' ? saved.quote : '',
    }
  } catch {
    return { text: '', quote: '' }
  }
}

export function clearChatDraft(scope?: string): void {
  try {
    const keys = scope === undefined
      ? Object.keys(sessionStorage).filter(key => key.startsWith(prefix))
      : [prefix + scope]
    keys.forEach(key => sessionStorage.removeItem(key))
  } catch {}
}

export function useChatDraft(scope: string) {
  const [current, setCurrent] = useState(() => ({ scope, ...loadDraft(scope) }))
  if (current.scope !== scope) setCurrent({ scope, ...loadDraft(scope) })

  function update(patch: Partial<Draft>) {
    const next = { ...current, ...patch }
    setCurrent(next)
    try {
      if (next.text || next.quote) sessionStorage.setItem(prefix + scope, JSON.stringify(next))
      else clearChatDraft(scope)
    } catch {}
  }

  return {
    text: current.text,
    quote: current.quote,
    setText: (text: string) => update({ text }),
    setQuote: (quote: string) => update({ quote }),
    clear: () => update({ text: '', quote: '' }),
  }
}
