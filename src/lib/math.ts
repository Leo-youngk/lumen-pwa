/**
 * Math rendering.
 *
 * KaTeX is ~280 KB, which is more than the entire application shell. It is
 * therefore loaded on demand: `ensureMath()` resolves the module the first time
 * a message actually contains math, and every component waits on the same
 * promise so the chunk is fetched once.
 *
 * Detection is deliberately conservative. A model writing about money will
 * produce `$5` and `$10`, and treating that as an inline formula would mangle
 * the text, so a `$...$` span only counts when it both starts and ends without
 * a space and contains no digits-only payload.
 */

type KatexModule = typeof import('katex')

/** The shape KaTeX actually exports at runtime (`default` is the API object). */
interface KatexApi {
  renderToString: (tex: string, options?: Record<string, unknown>) => string
}

let pending: Promise<KatexApi | null> | null = null
let loaded: KatexApi | null = null

/** Load KaTeX once. Resolves to null when the chunk cannot be fetched. */
export function ensureMath(): Promise<KatexApi | null> {
  if (loaded) return Promise.resolve(loaded)
  pending ??= import('katex')
    .then(async module => {
      // The stylesheet travels with the chunk so a page without math never
      // downloads KaTeX's CSS either.
      await import('katex/dist/katex.min.css')
      const candidate = (module as unknown as { default?: KatexModule }).default ?? module
      loaded = candidate as unknown as KatexApi
      return loaded
    })
    .catch(() => null)
  return pending
}

export interface MathSpan {
  kind: 'math'
  display: boolean
  tex: string
}

/** Does this string contain anything that looks like a formula? */
export function hasMath(source: string): boolean {
  if (!source.includes('$') && !source.includes('\\(') && !source.includes('\\[')) return false
  return (
    /\$\$[\s\S]+?\$\$/.test(source) ||
    /\\\[[\s\S]+?\\\]/.test(source) ||
    /\\\([\s\S]+?\\\)/.test(source) ||
    /\$(?!\s)(?:[^$\\]|\\.)+?(?<!\s)\$/.test(source)
  )
}

/**
 * Split text into plain and math segments.
 *
 * Handles `$$…$$` and `\[…\]` as display math, `$…$` and `\(…\)` as inline.
 * Unmatched delimiters are left in the plain text rather than swallowed.
 */
export function splitMath(source: string): (string | MathSpan)[] {
  const out: (string | MathSpan)[] = []
  // Display delimiters first so `$$` is never read as two inline spans.
  const pattern =
    /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?![\s$])((?:[^$\\]|\\.)+?)(?<![\s\\])\$/g

  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    if (match.index > last) out.push(source.slice(last, match.index))
    const display = match[1] !== undefined || match[2] !== undefined
    const tex = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
    out.push({ kind: 'math', display, tex: tex.trim() })
    last = match.index + match[0].length
  }
  if (last < source.length) out.push(source.slice(last))
  return out
}
