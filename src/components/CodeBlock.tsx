import { memo, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { highlight, isLanguageSupported } from '@/lib/highlighter'

/**
 * Fenced code block with syntax highlighting.
 *
 * Shiki is ~300 KB plus a grammar per language, so it is loaded on demand and
 * only the grammar for the language actually present is pulled in. Until the
 * highlighter resolves — and permanently, for languages it does not support —
 * the block renders as plain monospace, which keeps the text selectable and
 * correct rather than showing a spinner in the middle of an answer.
 */
export const CodeBlock = memo(function CodeBlock({ code, language, streaming = false }: { code: string; language: string; streaming?: boolean }) {
  const [highlighted, setHighlighted] = useState<{ code: string; language: string; html: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimeout = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (streaming || !language || !isLanguageSupported(language)) return
    let cancelled = false

    void highlight(code, language).then(result => {
      if (!cancelled && result) setHighlighted({ code, language, html: result })
    })

    return () => {
      cancelled = true
    }
  }, [code, language, streaming])

  useEffect(() => () => window.clearTimeout(copyTimeout.current), [])

  const html = highlighted?.code === code && highlighted.language === language ? highlighted.html : null

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.clearTimeout(copyTimeout.current)
      copyTimeout.current = window.setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard permission can be denied; silence is better than an alert.
    }
  }

  return (
    <div className="lumen-code">
      <div className="lumen-code__bar">
        <span className="lumen-code__lang">{language || 'code'}</span>
        <button type="button" onClick={copy} className="lumen-code__copy">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      {html ? (
        <div
          className="lumen-code__body lumen-code__body--hl"
          // Shiki emits its own <pre><code> with inline colours. The input is
          // escaped by the highlighter, so no model text reaches the DOM raw.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className={cn('lumen-code__body')}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
})
