import { useRef, useState } from 'react'
import { Composer } from '@/components/Composer'
import { Icon, IconButton, Tile } from '@/components/Icon'
import { NavigationBar } from '@/components/NavigationBar'
import { useLumen } from '@/state/LumenContext'
import { cn } from '@/lib/cn'
import type { BookRecord } from '@/lib/store'

export interface HomeScreenProps {
  onOpenHistory: () => void
  onOpenSettings: () => void
  onOpenModels: () => void
  onUpload: (file: File) => void
  uploading: boolean
  onOpenScope: () => void
  /** Called once a message is actually sent, so the shell can route to chat. */
  onSent: () => void
}

/**
 * The home screen.
 *
 * Layout follows what ChatGPT, Gemini and DeepSeek all converge on: the
 * composer is the centre of the screen rather than docked at the bottom, with
 * one short greeting above it and a few starter prompts below. There is no
 * hero graphic and no action cards — those read as a landing page, not an app.
 *
 * The composer starts centred here and is docked on the chat screen, so sending
 * the first message produces that "conversation has started" transition.
 */
export function HomeScreen({
  onOpenHistory,
  onOpenSettings,
  onOpenModels,
  onUpload,
  uploading,
  onOpenScope,
  onSent,
}: HomeScreenProps) {
  const { send, model, modelLabel, active, models, streaming } = useLumen()
  const [draft, setDraft] = useState('')
  const book = active?.book
  const upload = useRef<HTMLInputElement>(null)

  const suggestions = book
    ? ['梳理全书结构', '这本书的核心观点是什么', '哪些部分最值得重读']
    : ['帮我梳理一个想法', '把这段文字改写得更简洁', '解释一个我不理解的概念']

  return (
    <div className="relative h-full min-h-0">
      {/* No title and no divider up here: the greeting is the heading, and a
          bar above it would only add chrome. */}
      <NavigationBar
        divider={false}
        collapsed={false}
        leading={<IconButton icon="history" label="打开历史" onClick={onOpenHistory} />}
        trailing={<IconButton icon="settings" label="设置" onClick={onOpenSettings} />}
      />

      <div className="scroll-pane h-full" style={{ paddingTop: 'var(--nav-height)' }}>
        <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col justify-center px-4 py-8">
          <div className="mx-auto w-full max-w-[620px]">
            <h1 className="mb-7 text-center text-[26px] leading-tight font-semibold tracking-[-0.015em]">
              {book ? `聊聊《${book.title}》` : '今天想聊什么？'}
            </h1>

            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={text => {
                setDraft('')
                void send(text)
                onSent()
              }}
              onAttach={onUpload}
              disabled={uploading || streaming}
              placeholder={book ? '向这本书提问' : '问点什么…'}
              docked={false}
              trailing={
                <ModelPill
                  label={models.length ? modelLabel(model) : '模型'}
                  onClick={onOpenModels}
                />
              }
            />

            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {suggestions.map(text => (
                <button
                  key={text}
                  type="button"
                  disabled={uploading || streaming}
                  onClick={() => {
                    void send(text)
                    onSent()
                  }}
                  className={cn(
                    'rounded-full bg-field px-3.5 py-2 text-[13.5px] text-secondary',
                    'transition-colors duration-150 active:bg-(--separator-strong)',
                  )}
                >
                  {text}
                </button>
              ))}
            </div>

            {book ? (
              <div className="mt-6">
                <BookRow book={book} onClick={onOpenScope} />
              </div>
            ) : (
              <button
                type="button"
                disabled={uploading || streaming}
                onClick={() => upload.current?.click()}
                className="mx-auto mt-6 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-quiet transition-opacity active:opacity-50"
              >
                <Icon name="book" size={14} />
                {uploading ? '正在解析 EPUB…' : '导入 EPUB 书籍'}
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={upload}
        type="file"
        accept=".epub,application/epub+zip"
        hidden
        onChange={event => {
          const file = event.target.files?.[0]
          if (file) onUpload(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}

export function BookRow({ book, onClick }: { book: BookRecord; onClick: () => void }) {
  const detail = [
    `${book.chapterCount} 章`,
    book.unreadable ? `${book.unreadable} 节未提取` : '',
    book.focusChapter != null ? `第 ${book.focusChapter + 1} 章` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-[14px] bg-surface px-3.5 py-3 text-left',
        'hairline-t hairline-b transition-transform duration-150 active:scale-[0.995]',
      )}
    >
      <Tile icon="book" tone="brand">
        {book.cover ? <img alt="" src={book.cover} className="size-full object-cover" /> : undefined}
      </Tile>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-tight font-medium">{book.title}</span>
        <span className="mt-0.5 block truncate text-[12.5px] leading-tight text-quiet">{detail}</span>
      </span>
      <Icon name="right" size={14} className="text-(--separator-strong)" strokeWidth={2} />
    </button>
  )
}

/**
 * Model selector.
 *
 * Quiet text, not a chip: ChatGPT and DeepSeek both show the active model as
 * plain small text, and a pill with a status dot here competes with the send
 * button for attention.
 */
export function ModelPill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className={cn(
        'inline-flex h-8 max-w-[40vw] items-center gap-0.5 rounded-full px-1.5',
        'text-[13px] text-quiet transition-colors duration-150 active:bg-(--separator)',
      )}
    >
      <span className="truncate">{label}</span>
      <Icon name="down" size={11} strokeWidth={2.4} className="shrink-0" />
    </button>
  )
}
