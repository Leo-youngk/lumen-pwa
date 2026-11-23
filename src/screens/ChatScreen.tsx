import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Composer } from '@/components/Composer'
import { Icon, IconButton } from '@/components/Icon'
import { AssistantBubble, UserBubble } from '@/components/Message'
import { NavigationBar } from '@/components/NavigationBar'
import { useLumen } from '@/state/LumenContext'
import { cn } from '@/lib/cn'
import { BookRow, ModelPill } from './HomeScreen'

export interface ChatScreenProps {
  onBack: () => void
  onOpenOptions: () => void
  onOpenModels: () => void
  onOpenScope: () => void
  onUpload: (file: File) => void
  uploading: boolean
}

export function ChatScreen({
  onBack,
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
    usage,
    error,
    clearError,
    settings,
    model,
    modelLabel,
    models,
  } = useLumen()

  const [draft, setDraft] = useState('')
  const feed = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [belowFold, setBelowFold] = useState(false)

  const messages = active?.messages ?? []
  const last = messages.at(-1)
  const generating = streamingId === active?.id
  const progressLabel = readingProgress?.stage === 'direct'
    ? '正在使用所选范围的完整原文…'
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
    <div className="relative flex h-full min-h-0 flex-col">
      <NavigationBar
        divider={false}
        onBack={onBack}
        title={active.title}
        trailing={<IconButton icon="more" label="更多" onClick={onOpenOptions} />}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={feed}
          onScroll={onScroll}
          className="scroll-pane min-h-0 flex-1 overscroll-contain"
          style={{ paddingTop: 'var(--nav-height)' }}
        >
          <div className={cn('mx-auto w-full max-w-[680px] pt-2', settings.compactMode ? 'pb-2' : 'pb-4')}>
            {active.book ? (
              <div className="px-4 pt-1">
                <BookRow book={active.book} onClick={onOpenScope} />
              </div>
            ) : null}

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
        value={draft}
        onChange={setDraft}
        onSubmit={text => {
          setDraft('')
          void send(text)
        }}
        onStop={stop}
        streaming={generating}
        disabled={uploading || (streaming && !generating)}
        leading={uploading ? <p role="status" className="px-2 pb-1 text-[13px] text-quiet">正在把 EPUB 转为 Markdown…</p> : undefined}
        onAttach={onUpload}
        enterToSend={settings.enterToSend}
        placeholder={streaming ? '正在生成回答…' : '继续追问…'}
        trailing={
          <>
            <span className="text-[11px] tabular-nums text-quiet" title={`本设备已记录 ${usage.total.toLocaleString()} tokens，${usage.unreported} 次请求无用量回报`}>
              {usage.total ? new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(usage.total) : usage.unreported ? '—' : '0'} tokens
            </span>
            <ModelPill
              label={models.length ? modelLabel(active.model || model) : '默认模型'}
              onClick={onOpenModels}
            />
          </>
        }
      />
    </div>
  )
}
