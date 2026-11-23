import { useEffect, useState } from 'react'
import { ensureMath, splitMath, type MathSpan } from '@/lib/math'
import { cn } from '@/lib/cn'

/**
 * Render one formula.
 *
 * The component renders the raw TeX until KaTeX resolves, so a message with
 * math does not flash an empty gap while the chunk downloads. If the chunk or
 * the expression fails, the TeX is left visible rather than replaced by an
 * error box — a readable `\frac{a}{b}` beats a red message mid-answer.
 */
export function MathBlock({ span }: { span: MathSpan }) {
  const [html, setHtml] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void ensureMath().then(katex => {
      if (cancelled) return
      if (!katex) {
        setFailed(true)
        return
      }
      try {
        const rendered = katex.renderToString(span.tex, {
          displayMode: span.display,
          throwOnError: false,
          strict: false,
          trust: false,
          output: 'html',
        })
        if (!cancelled) setHtml(rendered)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [span.tex, span.display])

  if (failed || !html) {
    return (
      <code
        className={cn(
          'font-mono text-[0.9em] text-secondary',
          span.display ? 'my-2 block overflow-x-auto whitespace-pre-wrap' : 'inline',
        )}
      >
        {span.display ? `$$${span.tex}$$` : `$${span.tex}$`}
      </code>
    )
  }

  if (span.display) {
    return (
      <div
        className="scroll-pane my-3 overflow-x-auto py-1"
        // KaTeX output is sanitised by the library and rendered with
        // `trust: false`, so no user- or model-supplied markup can escape.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <span
      className="mx-[0.1em] inline-block align-baseline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Render a run of text, expanding any math spans inside it.
 *
 * `renderText` receives the plain segments so the caller keeps its existing
 * inline formatting (bold, code, links) without this component knowing about
 * it.
 */
export function TextWithMath({
  text,
  renderText,
}: {
  text: string
  renderText: (plain: string) => React.ReactNode
}) {
  const parts = splitMath(text)
  if (parts.length === 1 && typeof parts[0] === 'string') {
    return <>{renderText(text)}</>
  }
  return (
    <>
      {parts.map((part, index) =>
        typeof part === 'string' ? (
          <span key={index}>{renderText(part)}</span>
        ) : (
          <MathBlock key={index} span={part} />
        ),
      )}
    </>
  )
}

/** Preload KaTeX for a whole message as soon as math is detected in it. */
export function useMathPrefetch(source: string): void {
  useEffect(() => {
    if (source.includes('$') || source.includes('\\(') || source.includes('\\[')) {
      void ensureMath()
    }
  }, [source])
}
