import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Composer } from '@/components/Composer'
import { Icon } from '@/components/Icon'
import { AssistantBubble, UserBubble } from '@/components/Message'
import { NavIconButton, NavigationBar } from '@/components/NavigationBar'
import { useLumen } from '@/state/LumenContext'
import { cn } from '@/lib/cn'
import { useIsTouch } from '@/lib/viewport'

function answerContainer(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest('[data-assistant-answer]')
}

export interface ChatScreenProps {
  homeKey: number
  onOpenDrawer: () => void
  onOpenOptions: () => void
  onOpenModels: () => void
  onOpenScope: () => void
  onNew: () => void
  onUpload: (file: File) => void
  uploading: boolean
  onSent: () => void
}

export function ChatScreen({
  homeKey,
  onOpenDrawer,
  onOpenOptions,
  onOpenModels,
  onOpenScope,
  onNew,
  onUpload,
  uploading,
  onSent,
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

  const touch = useIsTouch()
  const conversationKey = active?.id ?? homeKey
  const [draftScope, setDraftScope] = useState(conversationKey)
  const [homeDraft, setHomeDraft] = useState('')
  const [homeDraftKey, setHomeDraftKey] = useState(homeKey)
  const [draft, setDraft] = useState('')
  const [selection, setSelection] = useState('')
  const [quote, setQuote] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const feed = useRef<HTMLDivElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [belowFold, setBelowFold] = useState(false)

  const messages = active?.messages ?? []
  const generating = streamingId === active?.id
  if (draftScope !== conversationKey) {
    setDraftScope(conversationKey)
    setDraft('')
    setSelection('')
    setQuote('')
    setBelowFold(false)
  }
  if (homeDraftKey !== homeKey) {
    setHomeDraftKey(homeKey)
    setHomeDraft('')
  }
  const progressLabel = readingProgress?.stage === 'direct'
    ? '正在发送所选范围内的全部正文…'
    : readingProgress?.stage === 'read'
      ? `已读原文 ${readingProgress.done}/${readingProgress.total} 批`
      : readingProgress
        ? `正在汇总 ${readingProgress.done}/${readingProgress.total} 批`
        : ''

  // The keyboard, draft, and streamed Markdown can all resize the feed.
  useLayoutEffect(() => {
    const node = feed.current
    const content = transcript.current
    if (!node || !content) return
    const followLatest = () => {
      if (!stick.current) return
      const bottom = node.scrollHeight - node.clientHeight
      if (Math.abs(node.scrollTop - bottom) > 1) node.scrollTop = bottom
    }
    if (node.dataset.conversation !== String(conversationKey)) {
      node.dataset.conversation = String(conversationKey)
      stick.current = true
    }
    followLatest()
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(followLatest)
    })
    observer.observe(node)
    observer.observe(content)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [conversationKey])

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
  }, [conversationKey])

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
    node.scrollTop = node.scrollHeight
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <NavigationBar
        leading={<NavIconButton icon="menu" label="打开对话列表" onClick={() => {
          input.current?.blur()
          onOpenDrawer()
        }} />}
        center={
          <button
            type="button"
            onClick={onOpenModels}
            aria-haspopup="dialog"
            aria-label="选择模型"
            className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-secondary active:bg-field"
          >
            <span className="min-w-0 truncate">{models.length ? modelLabel(active?.model || model) : '模型'}</span>
            <Icon name="down" size={12} className="shrink-0" />
          </button>
        }
        trailing={active
          ? <NavIconButton icon="more" label="更多" onClick={onOpenOptions} />
          : <NavIconButton icon="compose" label="新对话" onClick={onNew} />}
      />

      {active ? <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={feed}
          onScroll={onScroll}
          className="scroll-pane min-h-0 flex-1 overscroll-contain"
        >
          <div ref={transcript} className={cn('mx-auto w-full max-w-[680px] pt-2', settings.compactMode ? 'pb-2' : 'pb-4')}>
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
                  onRetry={index === messages.length - 1 && !streaming ? retry : undefined}
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
      </div> : (
        <div className="grid min-h-0 flex-1 place-items-center overflow-hidden px-4">
          <h1 className="text-center text-[24px] leading-tight font-medium tracking-[-0.01em] text-ink">
            有什么可以帮你？
          </h1>
        </div>
      )}

      <Composer
        inputRef={input}
        value={active ? draft : homeDraft}
        onChange={active ? setDraft : setHomeDraft}
        onSubmit={text => {
          if (active) setDraft('')
          else setHomeDraft('')
          setQuote('')
          stick.current = true
          setBelowFold(false)
          void send(text, quote || undefined)
          if (!active) onSent()
        }}
        onStop={stop}
        streaming={generating}
        disabled={uploading || (streaming && !generating)}
        leading={selection ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 flex justify-start px-4 pb-2">
            <button
              type="button"
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                setQuote(selection)
                setSelection('')
                window.getSelection()?.removeAllRanges()
                input.current?.focus({ preventScroll: true })
              }}
              className="pointer-events-auto inline-flex min-h-10 items-center gap-1.5 rounded-full border border-(--separator) bg-surface px-3 text-[14px] font-medium text-brand-ink shadow-lg active:scale-95"
            >
              <Icon name="quote" size={15} />
              引用追问
            </button>
          </div>
        ) : undefined}
        context={active?.book || quote || uploading ? (
          <div className="min-w-0 space-y-1 pb-0.5">
            {uploading ? <p role="status" className="px-2 text-[13px] text-quiet">正在转换 EPUB…</p> : null}
            {active?.book ? (
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
        enterToSend={!touch && settings.enterToSend}
        placeholder={active?.book && !messages.length ? '向这本书提问…' : active ? '继续追问…' : '问点什么…'}
      />
    </div>
  )
}
