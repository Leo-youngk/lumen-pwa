import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Composer } from '@/components/Composer'
import { Icon } from '@/components/Icon'
import { AssistantBubble, UserBubble } from '@/components/Message'
import { GlassButton, NavigationBar } from '@/components/NavigationBar'
import { useLumen } from '@/state/LumenContext'
import { cn } from '@/lib/cn'
import { ModelPill } from './HomeScreen'

function answerContainer(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest('[data-assistant-answer]')
}

export interface ChatScreenProps {
  onOpenDrawer: () => void
  onOpenOptions: () => void
  onOpenModels: () => void
  onOpenScope: () => void
  onUpload: (file: File) => void
  uploading: boolean
}

export function ChatScreen({
  onOpenDrawer,
  onOpenOptions,
  onOpenModels,
  onOpenScope,
  onUpload,
  uploading,
}: ChatScreenProps) {
  const {
    active,
    send,
    stop,
    retry,
    streaming,
    streamingId,
    readingProgress,
    error,
    clearError,
    settings,
    model,
    modelLabel,
    models,
  } = useLumen()

  const [draft, setDraft] = useState('')
  const [selection, setSelection] = useState('')
  const [quote, setQuote] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const feed = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [belowFold, setBelowFold] = useState(false)

  const messages = active?.messages ?? []
  const last = messages.at(-1)
  const generating = streamingId === active?.id
  const progressLabel = readingProgress?.stage === 'direct'
    ? '正在发送所选范围内的全部正文…'
    : readingProgress?.stage === 'read'
      ? `已读原文 ${readingProgress.done}/${readingProgress.total} 批`
      : readingProgress
        ? `正在汇总 ${readingProgress.done}/${readingProgress.total} 批`
        : ''

  // Follow new content only while the reader is already at the bottom. Once
  // they scroll up to re-read, the view must stay put.
  useLayoutEffect(() => {
    const node = feed.current
    if (node && stick.current) node.scrollTop = node.scrollHeight
  }, [messages.length, last?.content, last?.reasoning, error, progressLabel])

  useEffect(() => {
    let clearTimer: number | undefined
    function onSelectionChange() {
      window.clearTimeout(clearTimer)
      const current = window.getSelection()
      const answer = answerContainer(current?.anchorNode ?? null)
      const valid = current && !current.isCollapsed && answer && feed.current?.contains(answer)
        && answer === answerContainer(current.focusNode)
      if (valid) {
        setSelection(current.toString().trim())
      } else {
        // A touch can dismiss the selection immediately before dispatching its click.
        clearTimer = window.setTimeout(() => setSelection(''), 200)
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      window.clearTimeout(clearTimer)
    }
  }, [])

  const onScroll = useCallback(() => {
    const node = feed.current
    if (!node) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    stick.current = distance < 90
    setBelowFold(distance > 180)
  }, [])

  function jumpToLatest() {
    const node = feed.current
    if (!node) return
    stick.current = true
    node.scrollTo({
      top: node.scrollHeight,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }

  if (!active) return null

  return (
    <div className="screen-enter relative flex h-full min-h-0 flex-col">
      <NavigationBar
        leading={<GlassButton icon="menu" label="打开对话列表" onClick={onOpenDrawer} badge />}
        title={active.title}
        trailing={<GlassButton icon="more" label="更多" onClick={onOpenOptions} />}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={feed}
          onScroll={onScroll}
          className="scroll-pane min-h-0 flex-1 overscroll-contain"
          style={{ paddingTop: 64, paddingBottom: 'calc(var(--composer-height, 96px) + 12px)' }}
        >
          <div className={cn('mx-auto w-full max-w-[680px] pt-2', settings.compactMode ? 'pb-2' : 'pb-4')}>
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <UserBubble key={message.id} message={message} />
              ) : (
                <AssistantBubble
                  key={message.id}
                  message={message}
                  streaming={generating && !readingProgress && index === messages.length - 1}
                  compact={settings.compactMode}
                  fontSize={settings.fontSize}
                  lineHeight={settings.lineHeight}
                  onRetry={index === messages.length - 1 && !generating ? () => void retry() : undefined}
                />
              ),
            )}
            {generating && progressLabel ? (
              <p role="status" className="px-4 py-2 text-[13px] text-quiet">{progressLabel}</p>
            ) : null}

            {error ? (
              <div className="mx-4 my-3 rounded-[14px] bg-accent-orange px-3.5 py-3 text-[14px] text-accent-orange-ink">
                <p className="leading-snug">{error}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      clearError()
                      void retry()
                    }}
                    className="rounded-full bg-white/55 px-3 py-1 text-[13px] font-medium active:opacity-60"
                  >
                    重试
                  </button>
                  <button
                    type="button"
                    onClick={clearError}
                    className="rounded-full px-3 py-1 text-[13px] font-medium opacity-70 active:opacity-40"
                  >
                    关闭
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {belowFold ? (
          <button
            type="button"
            onClick={jumpToLatest}
            aria-label="滚动到最新消息"
            className={cn(
              'glass-chrome absolute bottom-3 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full',
              'text-secondary shadow-lg active:scale-95',
            )}
          >
            <Icon name="down" size={17} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>

      <Composer
        inputRef={input}
        value={draft}
        onChange={setDraft}
        onSubmit={text => {
          setDraft('')
          setQuote('')
          void send(text, quote || undefined)
        }}
        onStop={stop}
        streaming={generating}
        disabled={uploading || (streaming && !generating)}
        className="absolute inset-x-0 bottom-0 z-10 mx-auto w-full max-w-[680px]"
        leading={selection ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 flex justify-start px-4 pb-2">
            <button
              type="button"
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                setQuote(selection)
                setSelection('')
                window.getSelection()?.removeAllRanges()
                input.current?.focus()
              }}
              className="pointer-events-auto inline-flex min-h-10 items-center gap-1.5 rounded-full border border-(--separator) bg-surface px-3 text-[14px] font-medium text-brand-ink shadow-lg active:scale-95"
            >
              <Icon name="quote" size={15} />
              引用追问
            </button>
          </div>
        ) : undefined}
        context={active.book || quote ? (
          <div className="min-w-0 space-y-1 pb-0.5">
            {active.book ? (
              <button
                type="button"
                onClick={onOpenScope}
                aria-label="阅读范围"
                className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg bg-field px-2 text-left text-[12.5px] text-secondary active:opacity-60"
              >
                <Icon name="book" size={15} className="shrink-0" />
                <span className="min-w-0 truncate">{active.book.title}</span>
                {active.book.focusChapter != null ? (
                  <span className="shrink-0 text-quiet">第 {active.book.focusChapter + 1} 章</span>
                ) : null}
                <Icon name="down" size={11} className="shrink-0" />
              </button>
            ) : null}
            {quote ? (
              <div className="flex min-w-0 items-center gap-1.5 rounded-lg bg-field pl-2 text-[13px] text-secondary">
                <Icon name="quote" size={15} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate" aria-label="已引用的回答片段">{quote}</span>
                <button
                  type="button"
                  aria-label="移除引用"
                  onClick={() => setQuote('')}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-quiet active:opacity-50"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            ) : null}
          </div>
        ) : undefined}
        onAttach={onUpload}
        enterToSend={settings.enterToSend}
        placeholder={uploading ? '正在转换 EPUB…' : generating ? '正在生成回答…' : active.book && !messages.length ? '向这本书提问…' : '继续追问…'}
        trailing={
          <ModelPill
            label={models.length ? modelLabel(active.model || model) : '默认模型'}
            onClick={onOpenModels}
          />
        }
      />
    </div>
  )
}
