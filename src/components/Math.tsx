import { memo, useEffect, useState } from 'react'
import { ensureMath } from '@/lib/math'
import { cn } from '@/lib/cn'

/**
 * Render one formula.
 *
 * The component renders the raw TeX until KaTeX resolves, so a message with
 * math does not flash an empty gap while the chunk downloads. If the chunk or
 * the expression fails, the TeX is left visible rather than replaced by an
 * error box — a readable `\frac{a}{b}` beats a red message mid-answer.
 */
export const MathBlock = memo(function MathBlock({ tex, display }: { tex: string; display: boolean }) {
  const [rendered, setRendered] = useState<{ tex: string; display: boolean; html: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void ensureMath().then(katex => {
      if (cancelled) return
      if (!katex) return
      try {
        const html = katex.renderToString(tex, {
          displayMode: display,
          throwOnError: false,
          strict: false,
          trust: false,
          output: 'htmlAndMathml',
        })
        setRendered({ tex, display, html })
      } catch {
        // The readable TeX fallback stays in place.
      }
    })
    return () => {
      cancelled = true
    }
  }, [tex, display])

  const html = rendered?.tex === tex && rendered.display === display ? rendered.html : null
  if (!html) {
    return (
      <code
        className={cn(
          'font-mono text-[0.9em] text-secondary',
          display ? 'my-2 block overflow-x-auto whitespace-pre-wrap' : 'inline',
        )}
      >
        {display ? `$$${tex}$$` : `$${tex}$`}
      </code>
    )
  }

  if (display) {
    return (
      <div
        className="lumen-formula"
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
})
