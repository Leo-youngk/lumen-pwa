import { memo, useDeferredValue, useMemo, useRef, useState, type ReactNode } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { Streamdown, useIsCodeFenceIncomplete, type StreamdownProps } from 'streamdown'
import { CodeBlock } from './CodeBlock'
import { MathBlock } from './Math'
import { MathErrorBoundary } from './MathErrorBoundary'

const remarkPlugins = [remarkCjkFriendly, remarkMath, [remarkGfm, { singleTilde: false }]] satisfies StreamdownProps['remarkPlugins']
const rehypePlugins: NonNullable<StreamdownProps['rehypePlugins']> = []

function MarkdownPre({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

function MarkdownCode({ className, children }: React.ComponentProps<'code'>) {
  const incomplete = useIsCodeFenceIncomplete()
  const text = String(children ?? '').replace(/\n$/, '')
  const classes = className?.split(/\s+/) ?? []
  if (classes.includes('math-display') || classes.includes('math-inline')) {
    return <MathBlock tex={text} display={classes.includes('math-display')} />
  }
  const language = /language-([\w+-]+)/.exec(className ?? '')?.[1]
  if (language || String(children ?? '').includes('\n')) {
    return <CodeBlock code={text} language={language ?? ''} streaming={incomplete} />
  }
  return <code className="lumen-inline-code">{children}</code>
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  const tableRef = useRef<HTMLTableElement>(null)
  const [copyState, setCopyState] = useState('')
  async function copy() {
    const rows = Array.from(tableRef.current?.rows ?? [])
    const tsv = rows.map(row => Array.from(row.cells, cell => cell.innerText.trim().replace(/[\t\n]+/g, ' ')).join('\t')).join('\n')
    try {
      await navigator.clipboard.writeText(tsv)
      setCopyState('已复制')
    } catch {
      setCopyState('复制失败')
    }
  }

  return (
    <div className="lumen-table-wrap">
      <div className="lumen-table__bar">
        <button type="button" onClick={() => void copy()} aria-label="复制表格" className="lumen-code__copy">
          {copyState || '复制表格'}
        </button>
      </div>
      <div className="lumen-table__scroll"><table ref={tableRef}>{children}</table></div>
    </div>
  )
}

function MarkdownLink({ href, children, id, ...props }: React.ComponentProps<'a'>) {
  const external = href && !href.startsWith('#')
  return (
    <a
      href={href || undefined}
      id={id}
      aria-describedby={props['aria-describedby']}
      data-footnote-ref={Reflect.get(props, 'data-footnote-ref')}
      data-footnote-backref={Reflect.get(props, 'data-footnote-backref')}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer noopener' : undefined}
      className="lumen-link"
    >
      {children}
    </a>
  )
}

const components = {
  pre: MarkdownPre,
  code: MarkdownCode,
  table: MarkdownTable,
  a: MarkdownLink,
  strong: 'strong',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  blockquote: 'blockquote',
} as StreamdownProps['components']
const urlTransform: NonNullable<StreamdownProps['urlTransform']> = (url, key) =>
  (key === 'href' ? /^(https?:|mailto:|#)/i : /^https?:/i).test(url) ? url : ''

/** Apply only to Markdown text outside code and link destinations. */
function prepareMath(source: string): string {
  if (!/\$|\\[[(]/.test(source)) return source
  const replacements = /(^|\n)([ \t]{0,3})\$\$([^\n$]+?)\$\$[ \t]*(?=\n|$)|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|(?<![\\$\w])\$\d+(?:[,.]\d+)*(?=$|[，。；、,:!?）]|[ \t]+[a-z\u3400-\u9fff]|[\u3400-\u9fff])/gim
  if (!replacements.test(source)) return source
  replacements.lastIndex = 0

  const protectedRanges: { start: number; end: number }[] = []
  function collect(node: ReturnType<typeof fromMarkdown> | ReturnType<typeof fromMarkdown>['children'][number]) {
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'link' || node.type === 'image' || node.type === 'definition' || node.type === 'html') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) protectedRanges.push({ start, end })
    } else if ('children' in node) {
      for (const child of node.children) collect(child as Parameters<typeof collect>[0])
    }
  }
  collect(fromMarkdown(source))

  return source.replace(replacements, (match, lead, indent, display, bracket, inline, offset: number) => {
    const start = offset + (lead?.length ?? 0)
    if (protectedRanges.some(range => range.start < offset + match.length && range.end > start)) return match
    if (display !== undefined) return `${lead}${indent}$$\n${indent}${display.trim()}\n${indent}$$`
    if (bracket !== undefined) {
      const line = source.lastIndexOf('\n', offset - 1) + 1
      if (source.slice(line, offset).trim()) return `$${bracket.trim().replace(/\n/g, ' ')}$`
      return `$$\n${bracket.trim()}\n$$`
    }
    if (inline !== undefined) return `$${inline.trim()}$`
    return `\\${match}`
  })
}

export const Markdown = memo(function Markdown({ source, streaming }: { source: string; streaming: boolean }) {
  const deferred = useDeferredValue(source)
  const text = streaming ? deferred : source
  const prepared = useMemo(() => prepareMath(text), [text])
  // Definitions and references must be available to all paragraphs of the message.
  const splitBlocks = !/^\s{0,3}\[[^\n\]]+\]:/m.test(prepared)
  return (
    <div className="lumen-prose lumen-prose--chat">
      <MathErrorBoundary fallback={source}>
        <Streamdown
          mode={streaming && splitBlocks ? 'streaming' : 'static'}
          isAnimating={streaming}
          normalizeHtmlIndentation={false}
          controls={false}
          components={components}
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          skipHtml
          urlTransform={urlTransform}
        >
          {prepared}
        </Streamdown>
      </MathErrorBoundary>
    </div>
  )
})
