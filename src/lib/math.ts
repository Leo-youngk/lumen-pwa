/**
 * Math rendering.
 *
 * KaTeX is ~280 KB, which is more than the entire application shell. It is
 * therefore loaded on demand: `ensureMath()` resolves the module the first time
 * a message actually contains math, and every component waits on the same
 * promise so the chunk is fetched once.
 *
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
