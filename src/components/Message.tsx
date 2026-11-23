import { Suspense, lazy, memo, useState } from 'react'
import type { Message } from '@/lib/store'
import { cn } from '@/lib/cn'
import { Icon } from './Icon'
import { TypingIndicator } from './TypingIndicator'

/**
 * The Markdown pipeline (react-markdown + remark + rehype, ~67 KB gzip) is
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
        <div className="text-ink" style={{ fontSize: `${fontSize}px`, lineHeight }}>
          {/* Plain text is shown while the chunk loads, so a resumed
              conversation paints immediately instead of flashing blank. */}
          <Suspense fallback={<RawText text={message.content} />}>
            <Markdown source={message.content} />
          </Suspense>
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

/** Pre-Markdown fallback: preserves line breaks, nothing else. */
function RawText({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap">{text}</div>
}
