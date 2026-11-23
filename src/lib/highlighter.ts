/**
 * Syntax highlighting.
 *
 * Shiki with the JavaScript RegExp engine. The Oniguruma WASM engine is faster
 * on very large files but adds a ~600 KB binary; an answer-sized snippet does
 * not benefit, and skipping it keeps the lazy chunk small.
 *
 * Each grammar is imported separately, so a Python snippet never downloads the
 * Rust grammar. Everything here is behind a dynamic import from the component,
 * so a conversation without code pays nothing.
 */

type Highlighter = {
  codeToHtml: (code: string, options: Record<string, unknown>) => string
  loadLanguage: (grammar: unknown) => Promise<void>
}

let highlighter: Highlighter | null = null
let loading: Promise<Highlighter | null> | null = null
const loadedLanguages = new Set<string>()

/** Grammars we ship, keyed by the canonical language id. */
const GRAMMARS: Record<string, () => Promise<unknown>> = {
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  tsx: () => import('shiki/dist/langs/tsx.mjs'),
  jsx: () => import('shiki/dist/langs/jsx.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  bash: () => import('shiki/dist/langs/bash.mjs'),
  shellscript: () => import('shiki/dist/langs/shellscript.mjs'),
  css: () => import('shiki/dist/langs/css.mjs'),
  html: () => import('shiki/dist/langs/html.mjs'),
  markdown: () => import('shiki/dist/langs/markdown.mjs'),
  sql: () => import('shiki/dist/langs/sql.mjs'),
  go: () => import('shiki/dist/langs/go.mjs'),
  rust: () => import('shiki/dist/langs/rust.mjs'),
  java: () => import('shiki/dist/langs/java.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
  toml: () => import('shiki/dist/langs/toml.mjs'),
  diff: () => import('shiki/dist/langs/diff.mjs'),
}

/** Fence labels that map onto a grammar we ship. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  python3: 'python',
  sh: 'bash',
  zsh: 'bash',
  shell: 'shellscript',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  golang: 'go',
  patch: 'diff',
}

function resolve(language: string): string {
  const key = language.toLowerCase()
  return ALIASES[key] ?? key
}

export function isLanguageSupported(language: string): boolean {
  return Boolean(GRAMMARS[resolve(language)])
}

async function getHighlighter(): Promise<Highlighter | null> {
  loading ??= (async () => {
    try {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/javascript'),
      ])
      const instance = await createHighlighterCore({
        themes: [
          import('shiki/dist/themes/github-light.mjs'),
          import('shiki/dist/themes/github-dark.mjs'),
        ],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      })
      highlighter = instance as unknown as Highlighter
      return highlighter
    } catch {
      return null
    }
  })()
  return loading
}

/**
 * Highlight one block. Resolves to null when the language is unknown or the
 * highlighter fails, which tells the caller to keep plain monospace.
 */
export async function highlight(code: string, language: string): Promise<string | null> {
  const lang = resolve(language)
  const grammar = GRAMMARS[lang]
  if (!grammar) return null

  const instance = highlighter ?? (await getHighlighter())
  if (!instance) return null

  if (!loadedLanguages.has(lang)) {
    try {
      await instance.loadLanguage(await grammar())
      loadedLanguages.add(lang)
    } catch {
      return null
    }
  }

  try {
    return instance.codeToHtml(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      // Dual-theme output resolves through CSS variables, so switching the app
      // theme recolours the block without re-tokenising it.
      defaultColor: false,
    })
  } catch {
    return null
  }
}
