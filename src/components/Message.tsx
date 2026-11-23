import { memo, useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { splitMath } from '@/lib/math'
import type { Message } from '@/lib/store'
import { Icon } from './Icon'
import { MathBlock, useMathPrefetch } from './Math'

/**
 * Minimal Markdown renderer.
 *
 * The previous build pulled a full Markdown + KaTeX + Shiki pipeline (about
 * 1.4 MB of chunks). This rewrite keeps the parts that matter for reading a
 * model's answer — paragraphs, lists, headings, quotes, inline code, fenced
 * code, bold/italic, and links — and drops syntax highlighting. Inline styles
 * are applied with React elements rather than `dangerouslySetInnerHTML`, so a
 * model's output can never inject markup into the page.
 */

type Inline = { type: 'text'; value: string } | { type: 'code'; value: string }

function parseInline(source: string): Inline[] {
  const parts: Inline[] = []
  const pattern = /`([^`]+)`/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    if (match.index > last) parts.push({ type: 'text', value: source.slice(last, match.index) })
    parts.push({ type: 'code', value: match[1] ?? '' })
    last = match.index + match[0].length
  }
  if (last < source.length) parts.push({ type: 'text', value: source.slice(last) })
  return parts
}

/**
 * Render one run of inline text.
 *
 * Math is split out *first*. If bold/italic parsing ran over the whole string
 * it would rewrite the `*` and `_` characters inside TeX (`\frac{a}{b}` has no
 * asterisks, but `a_b` and `x^*` do), corrupting formulas before KaTeX ever
 * sees them.
 */
function InlineText({ text }: { text: string }) {
  const segments = useMemo(() => splitMath(text), [text])
  if (segments.length === 1 && typeof segments[0] === 'string') {
    return <InlineFormatting text={text} />
  }
  return (
    <>
      {segments.map((segment, index) =>
        typeof segment === 'string' ? (
          <InlineFormatting key={index} text={segment} />
        ) : (
          <MathBlock key={index} span={segment} />
        ),
      )}
    </>
  )
}

/** Bold, italic, `code` and links — applied to plain, non-math text only. */
function InlineFormatting({ text }: { text: string }) {
  const nodes = useMemo(() => {
    const out: React.ReactNode[] = []
    const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
    const segments = text.split(pattern)
    segments.forEach((segment, index) => {
      if (!segment) return
      if (segment.startsWith('**') && segment.endsWith('**')) {
        out.push(
          <strong key={index} className="font-semibold">
            {segment.slice(2, -2)}
          </strong>,
        )
      } else if (segment.startsWith('*') && segment.endsWith('*') && segment.length > 2) {
        out.push(
          <em key={index} className="italic">
            {segment.slice(1, -1)}
          </em>,
        )
      } else if (/^\[[^\]]+\]\([^)]+\)$/.test(segment)) {
        const label = segment.slice(1, segment.indexOf(']'))
        const href = segment.slice(segment.indexOf('(') + 1, -1)
        out.push(
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-brand underline decoration-brand/30 underline-offset-2"
          >
            {label}
          </a>,
        )
      } else {
        parseInline(segment).forEach((piece, pieceIndex) =>
          out.push(
            piece.type === 'code' ? (
              <code
                key={`${index}-${pieceIndex}`}
                className="rounded-[5px] bg-field px-1.5 py-0.5 font-mono text-[0.88em]"
              >
                {piece.value}
              </code>
            ) : (
              <span key={`${index}-${pieceIndex}`}>{piece.value}</span>
            ),
          ),
        )
      }
    })
    return out
  }, [text])

  return <>{nodes}</>
}

interface Block {
  kind: 'p' | 'h' | 'ul' | 'ol' | 'quote' | 'code' | 'math'
  lines: string[]
  language?: string
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (!line.trim()) {
      index += 1
      continue
    }

    // Fenced code
    if (line.trimStart().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      const body: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push({ kind: 'code', lines: body, language })
      continue
    }

    // Display math on its own lines: $$ … $$ or \[ … \]
    const displayOpen = /^(\$\$|\\\[)\s*$/.test(line.trim())
    if (displayOpen) {
      const closer = line.trim().startsWith('$$') ? '$$' : '\\]'
      const body: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trim().endsWith(closer)) {
        body.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) {
        const tail = (lines[index] ?? '').trim()
        const beforeCloser = tail.slice(0, tail.length - closer.length)
        if (beforeCloser) body.push(beforeCloser)
        index += 1
      }
      blocks.push({ kind: 'math', lines: [body.join('\n')] })
      continue
    }

    // A one-line $$…$$ is display math too.
    const singleDisplay = /^\$\$([\s\S]+)\$\$$/.exec(line.trim())
    if (singleDisplay) {
      blocks.push({ kind: 'math', lines: [singleDisplay[1] ?? ''] })
      index += 1
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'h', lines: [heading[2] ?? ''] })
      index += 1
      continue
    }

    // Unordered list, allowing nested indentation to stay in one block.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*+]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'ul', lines: items })
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'ol', lines: items })
      continue
    }

    if (line.trimStart().startsWith('>')) {
      const quoted: string[] = []
      while (index < lines.length && (lines[index] ?? '').trimStart().startsWith('>')) {
        quoted.push((lines[index] ?? '').replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', lines: quoted })
      continue
    }

    // Table rows are rendered as preformatted text: a real table needs column
    // measurement that is not worth 20 KB of code, and monospace rows stay
    // readable for the kinds of tables a model produces.
    if (line.trimStart().startsWith('|')) {
      const rows: string[] = []
      while (index < lines.length && (lines[index] ?? '').trimStart().startsWith('|')) {
        rows.push(lines[index] ?? '')
        index += 1
      }
      blocks.push({ kind: 'code', lines: rows, language: 'table' })
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (!current.trim()) break
      if (/^(#{1,4})\s|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*>|^```|^\s*\|/.test(current)) break
      paragraph.push(current)
      index += 1
    }
    if (paragraph.length) blocks.push({ kind: 'p', lines: paragraph })
    else index += 1
  }

  return blocks
}

function CodeBlock({ lines, language }: { lines: string[]; language?: string }) {
  const [copied, setCopied] = useState(false)
  const text = lines.join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard access can be denied; failing silently is better than an alert.
    }
  }

  if (language === 'table') {
    return (
      <pre className="scroll-pane -mx-1 my-3 overflow-x-auto rounded-[12px] bg-field p-3 font-mono text-[12.5px] leading-[1.6]">
        {text}
      </pre>
    )
  }

  return (
    <div className="my-3 overflow-hidden rounded-[12px] bg-field">
      <div className="hairline-b flex items-center justify-between px-3 py-1.5">
        <span className="font-mono text-[11px] tracking-wide text-quiet uppercase">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={copy}
          className="text-[12px] font-medium text-brand active:opacity-50"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="scroll-pane overflow-x-auto p-3 font-mono text-[13px] leading-[1.6]">
        {text}
      </pre>
    </div>
  )
}

export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseBlocks(source), [source])
  useMathPrefetch(source)
  return (
    <div className="lumen-prose">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'h':
            return (
              <h3 key={index} className="mt-4 mb-1.5 text-[16.5px] font-semibold first:mt-0">
                <InlineText text={block.lines[0] ?? ''} />
              </h3>
            )
          case 'ul':
            return (
              <ul key={index} className="my-2 list-disc space-y-1 pl-5">
                {block.lines.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <InlineText text={item} />
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={index} className="my-2 list-decimal space-y-1 pl-5">
                {block.lines.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <InlineText text={item} />
                  </li>
                ))}
              </ol>
            )
          case 'quote':
            return (
              <blockquote
                key={index}
                className="my-3 border-l-2 border-brand/35 pl-3 text-secondary italic"
              >
                <InlineText text={block.lines.join(' ')} />
              </blockquote>
            )
          case 'code':
            return <CodeBlock key={index} lines={block.lines} language={block.language} />
          case 'math':
            return (
              <MathBlock key={index} span={{ kind: 'math', display: true, tex: block.lines[0] ?? '' }} />
            )
          default:
            return (
              <p key={index} className="my-2 first:mt-0 last:mb-0">
                <InlineText text={block.lines.join('\n')} />
              </p>
            )
        }
      })}
    </div>
  )
}

/* -------------------------------------------------------------- bubbles */

/**
 * A user turn.
 *
 * Rendered as a tinted block rather than a chat bubble with a tail: ChatGPT,
 * Gemini and DeepSeek all dropped the tail, and at this width a tail mostly
 * just makes the text feel boxed in.
 */
export const UserBubble = memo(function UserBubble({ message }: { message: Message }) {
  return (
    <div className="flex justify-end px-4 py-1.5">
      <div
        className={cn(
          'max-w-[88%] rounded-[14px] bg-bubble px-3.5 py-2.5',
          'text-[15.5px] leading-[1.55] whitespace-pre-wrap break-words',
        )}
      >
        {message.content}
      </div>
    </div>
  )
})

export const AssistantBubble = memo(function AssistantBubble({
  message,
  streaming,
  compact,
  fontSize,
  lineHeight,
}: {
  message: Message
  streaming: boolean
  compact: boolean
  fontSize: number
  lineHeight: number
}) {
  const [showReasoning, setShowReasoning] = useState(false)
  const hasReasoning = Boolean(message.reasoning?.trim())
  const empty = !message.content.trim()

  return (
    <div className="px-4 py-2">
      {/* No avatar and no "Lumen" label. The assistant voice is obvious from
          the layout, and branding each turn is the single strongest tell of a
          template chat UI. */}
      {hasReasoning ? (
        <div className="mb-1.5">
          <button
            type="button"
            onClick={() => setShowReasoning(value => !value)}
            className="inline-flex items-center gap-1 text-[13px] text-quiet transition-opacity active:opacity-50"
          >
            <Icon name={showReasoning ? 'down' : 'right'} size={11} strokeWidth={2.2} />
            {showReasoning ? '收起思考' : '思考过程'}
          </button>
          {showReasoning ? (
            <div className="mt-1 border-l border-(--separator-strong) pl-2.5 text-[13px] leading-[1.7] whitespace-pre-wrap text-quiet">
              {message.reasoning}
            </div>
          ) : null}
        </div>
      ) : null}

      {empty && streaming ? (
        <TypingIndicator />
      ) : (
        <div
          className="text-ink"
          style={{ fontSize: `${fontSize}px`, lineHeight }}
        >
          <Markdown source={message.content} />
          {streaming ? (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.16em] animate-pulse bg-ink/70 align-baseline"
            />
          ) : null}
        </div>
      )}

      {compact ? null : <div className="h-2" />}
    </div>
  )
})

/** Three dots that rise in sequence, matching the iOS activity idiom. */
export function TypingIndicator() {
  return (
    <div className="flex h-6 items-center gap-1" role="status" aria-label="正在生成回答">
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className="size-[6px] rounded-full bg-quiet"
          style={{
            animation: 'lumen-bounce 1.15s ease-in-out infinite',
            animationDelay: `${index * 0.14}s`,
          }}
        />
      ))}
    </div>
  )
}
