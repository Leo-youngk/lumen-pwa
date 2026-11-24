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
    <div className="flex justify-end px-4 py-2">
      <div
        className={cn(
          'max-w-[88%] rounded-[18px] bg-bubble px-4 py-2.5',
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
  onRetry,
}: {
  message: Message
  streaming: boolean
  compact: boolean
  fontSize: number
  lineHeight: number
  onRetry?: () => void
}) {
  const [showReasoning, setShowReasoning] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'done' | 'error'>('idle')
  const [speaking, setSpeaking] = useState(false)
  const hasReasoning = Boolean(message.reasoning?.trim())
  const empty = !message.content.trim()

  useEffect(() => {
    if (copyStatus !== 'done') return
    const timer = window.setTimeout(() => setCopyStatus('idle'), 1500)
    return () => window.clearTimeout(timer)
  }, [copyStatus])

  // Stop the voice if the message unmounts (navigating away mid-read).
  useEffect(() => () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopyStatus('done')
    } catch {
      setCopyStatus('error')
    }
  }

  function speak() {
    if (!('speechSynthesis' in window)) return
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const text = plainText(message.content)
    if (!text) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  return (
    <div className="px-4 py-3">
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
      {message.incomplete && !streaming ? <p className="mt-1 text-[12px] text-quiet">回答未完成</p> : null}

      {!empty && !streaming ? (
        <div className="mt-1 flex items-center gap-0.5">
          <MessageAction
            icon={copyStatus === 'done' ? 'check' : 'copy'}
            label={copyStatus === 'done' ? '已复制回答' : '复制回答'}
            onClick={() => void copyAnswer()}
          />
          {onRetry ? <MessageAction icon="refresh" label="重新生成" onClick={onRetry} /> : null}
          <MessageAction
            icon={speaking ? 'stop' : 'speaker'}
            label={speaking ? '停止朗读' : '朗读回答'}
            onClick={speak}
          />
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

/** Icon-only action under an answer, matching the assistant-app convention. */
function MessageAction({
  icon,
  label,
  onClick,
}: {
  icon: 'copy' | 'check' | 'refresh' | 'speaker' | 'stop'
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="-ml-1.5 grid size-9 place-items-center rounded-full text-quiet transition-colors duration-150 hover:text-ink active:bg-(--separator)"
    >
      <Icon name={icon} size={16} strokeWidth={1.9} />
    </button>
  )
}

/** Strip Markdown syntax before handing text to the speech synthesiser. */
function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
