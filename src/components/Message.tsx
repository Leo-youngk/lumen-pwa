import { Suspense, lazy, memo, useEffect, useState } from 'react'
import type { Message } from '@/lib/store'
import { cn } from '@/lib/cn'
import { Icon } from './Icon'
import { TypingIndicator } from './TypingIndicator'

/**
 * The Markdown pipeline is
 * loaded the first time an answer is rendered. The home screen has no answers
 * and the sign-in screen has none either, so a cold start never pays for it.
 */
const Markdown = lazy(() =>
  import('./Markdown').then(module => ({ default: module.Markdown })),
)

export const UserBubble = memo(function UserBubble({ message }: { message: Message }) {
  return (
    <div className="flex justify-end px-4 py-1.5">
      <div
        className={cn(
          'max-w-[88%] rounded-[14px] bg-bubble px-3.5 py-2.5',
          'text-[15.5px] leading-[1.55] whitespace-pre-wrap break-words',
        )}
      >
        {message.quote ? (
          <blockquote aria-label="引用的回答" title={message.quote} className="mb-1 line-clamp-3 border-l-2 border-(--separator-strong) pl-2 text-[13px] whitespace-pre-line text-quiet">
            {message.quote}
          </blockquote>
        ) : null}
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
  const [copyStatus, setCopyStatus] = useState<'idle' | 'done' | 'error'>('idle')
  const hasReasoning = Boolean(message.reasoning?.trim())
  const empty = !message.content.trim()

  useEffect(() => {
    if (copyStatus !== 'done') return
    const timer = window.setTimeout(() => setCopyStatus('idle'), 1500)
    return () => window.clearTimeout(timer)
  }, [copyStatus])

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopyStatus('done')
    } catch {
      setCopyStatus('error')
    }
  }

  return (
    <div className="px-4 py-2">
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
        <div data-assistant-answer="" className="select-text text-ink" style={{ fontSize: `${fontSize}px`, lineHeight }}>
          {/* Plain text is shown while the chunk loads, so a resumed
              conversation paints immediately instead of flashing blank. */}
          <Suspense fallback={<RawText text={message.content} />}>
            <Markdown source={message.content} streaming={streaming} />
          </Suspense>
          {streaming ? (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.16em] animate-pulse bg-ink/70 align-baseline"
            />
          ) : null}
        </div>
      )}
      {message.incomplete ? <p className="mt-1 text-[12px] text-quiet">回答未完成</p> : null}

      {!empty && !streaming ? (
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copyAnswer()}
            aria-label={copyStatus === 'done' ? '已复制回答' : '复制回答'}
            className="-ml-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] text-quiet hover:bg-(--separator) active:opacity-60"
          >
            <Icon name={copyStatus === 'done' ? 'check' : 'copy'} size={15} />
            {copyStatus === 'done' ? '已复制' : '复制'}
          </button>
          <span role="status" className={copyStatus === 'error' ? 'text-[12px] text-quiet' : 'sr-only'}>
            {copyStatus === 'error' ? '复制失败，请选中文字后复制。' : copyStatus === 'done' ? '已复制回答' : ''}
          </span>
        </div>
      ) : null}

      {compact ? null : <div className="h-2" />}
    </div>
  )
})

/** Pre-Markdown fallback: preserves line breaks, nothing else. */
function RawText({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap">{text}</div>
}
