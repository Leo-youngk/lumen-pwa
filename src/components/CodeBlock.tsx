import { useEffect, useRef, useState } from 'react'
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
export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    setHtml(null)
    if (!language || !isLanguageSupported(language)) return

    void highlight(code, language).then(result => {
      if (mounted.current) setHtml(result)
    })

    return () => {
      mounted.current = false
    }
  }, [code, language])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
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
}
