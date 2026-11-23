import { memo, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkCjkFriendly from 'remark-cjk-friendly'
import rehypeKatex from 'rehype-katex'
import { cn } from '@/lib/cn'
import { CodeBlock } from './CodeBlock'
import { MathErrorBoundary } from './MathErrorBoundary'

/**
 * Assistant answer renderer.
 *
 * Built on react-markdown rather than a hand-rolled parser. The hand-rolled one
 * handled paragraphs and bullets, but tables came out as preformatted text, and
 * there was no syntax highlighting or footnote support.
 *
 * Plugin order follows what LobeHub ships in production, and both comments are
 * bugs they hit:
 *
 * 1. `remark-cjk-friendly` first — CommonMark's emphasis rules treat CJK
 *    punctuation as whitespace, so `**中文**，` fails to bold and trailing
 *    full-width brackets get swallowed into autolinks.
 * 2. `remark-math` before `remark-gfm` — otherwise a `|` inside `$…$` is read
 *    as a table column separator.
 * 3. `rehype-katex` after the tree is settled.
 */

const remarkPlugins = [remarkCjkFriendly, remarkMath, [remarkGfm, { singleTilde: false }] as const]
const rehypePlugins = [
  [rehypeKatex, { throwOnError: false, strict: false, output: 'html' }] as const,
]

/** react-markdown wraps a fenced block in <pre><code>; CodeBlock owns both. */
function pre({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

function code({ className, children }: { className?: string; children?: ReactNode }) {
  const text = String(children ?? '').replace(/\n$/, '')
  const match = /language-([\w+-]+)/.exec(className ?? '')

  if (match) return <CodeBlock code={text} language={match[1] ?? ''} />
  // A fenced block with no language still arrives with a trailing newline.
  if (String(children ?? '').includes('\n')) return <CodeBlock code={text} language="" />

  return <code className="lumen-inline-code">{children}</code>
}

/** Wrapper enables horizontal scroll for wide tables. */
function table({ children }: { children?: ReactNode }) {
  return (
    <div className="lumen-table-wrap">
      <table>{children}</table>
    </div>
  )
}

function link({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="lumen-link">
      {children}
    </a>
  )
}

const components: Components = { pre, code, table, a: link }

/**
 * Normalise display math onto its own lines.
 *
 * micromark's math flow requires the `$$` fences to open and close on their own
 * lines. Models routinely emit `$$x = y$$` as a single line, which then parses
 * as inline math and renders at body size mid-paragraph. Splitting it here is
 * cheaper than a remark plugin and covers the case everywhere.
 */
function normaliseDisplayMath(source: string): string {
  return source.replace(/(^|\n)[ \t]*\$\$([^\n$]+?)\$\$[ \t]*(?=\n|$)/g, (_match, lead, body) => {
    return `${lead}$$\n${body.trim()}\n$$`
  })
}

export interface MarkdownProps {
  source: string
}

export const Markdown = memo(function Markdown({ source }: MarkdownProps) {
  const plugins = useMemo(() => ({ remark: remarkPlugins, rehype: rehypePlugins }), [])
  const normalised = useMemo(() => normaliseDisplayMath(source), [source])
  return (
    <div className={cn('lumen-prose', 'lumen-prose--chat')}>
      <MathErrorBoundary>
        <ReactMarkdown
          remarkPlugins={plugins.remark as never}
          rehypePlugins={plugins.rehype as never}
          components={components}
          // Raw HTML is never rendered: model output must not be able to inject
          // markup, and no answer we care about needs it.
          skipHtml
          urlTransform={url => (/^(https?:|mailto:)/i.test(url) ? url : '')}
        >
          {normalised}
        </ReactMarkdown>
      </MathErrorBoundary>
    </div>
  )
})
