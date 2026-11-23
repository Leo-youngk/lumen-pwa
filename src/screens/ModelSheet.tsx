import { useEffect, useMemo, useState } from 'react'
import { Sheet } from '@/components/Sheet'
import { Row } from '@/components/List'
import { Icon, IconButton } from '@/components/Icon'
import { useLumen } from '@/state/LumenContext'
import { getBook } from '@/lib/store'
import { cn } from '@/lib/cn'

export function ModelSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { models, model, setModel, modelStatus, refreshModels } = useLumen()
  const [query, setQuery] = useState('')
  const searchable = models.length > 8

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return models
    return models.filter(item =>
      `${item.name} ${item.id} ${item.family}`.toLowerCase().includes(needle),
    )
  }, [models, query])

  return (
    <Sheet open={open} title="选择模型" onClose={onClose} size="tall">
      <div className="-mx-4">
        <div className="flex items-center justify-between px-4 pb-3">
          <p role="status" className="text-[13px] text-quiet">
            {modelStatus.state === 'ready'
              ? `共 ${models.length} 个可用模型`
              : modelStatus.state === 'loading'
                ? '正在读取模型…'
                : modelStatus.message}
          </p>
          <IconButton
            icon="refresh"
            label="刷新模型"
            variant="quiet"
            onClick={refreshModels}
            disabled={modelStatus.state === 'loading'}
          />
        </div>

        {searchable ? (
          <label className="mx-4 mb-3 flex h-9 items-center gap-2 rounded-[10px] bg-field px-2.5">
            <Icon name="search" size={16} className="text-quiet" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索模型"
              aria-label="搜索模型"
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-quiet"
            />
          </label>
        ) : null}

        <div className="overflow-hidden bg-surface hairline-t hairline-b">
          {visible.length ? (
            visible.map((option, index) => {
              const picked = option.id === model
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={picked}
                  onClick={() => {
                    setModel(option.id)
                    onClose()
                  }}
                  className={cn(
                    'flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left',
                    'active:bg-(--separator)',
                    index > 0 && 'border-t border-(--separator)',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] leading-tight">{option.name}</span>
                    <span className="mt-0.5 block truncate text-[13px] leading-tight text-quiet">
                      {[option.family, option.capacity ? `${option.capacity} 上下文` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {picked ? (
                    <Icon name="check" size={17} strokeWidth={2.2} className="text-brand" />
                  ) : null}
                </button>
              )
            })
          ) : (
            <p className="px-4 py-8 text-center text-[14px] text-quiet">
              {query
                ? '没有匹配的模型'
                : modelStatus.state === 'loading'
                  ? '正在连接模型服务'
                  : '暂无可用模型'}
            </p>
          )}
        </div>
      </div>
    </Sheet>
  )
}

export function ScopeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { active, updateConversation } = useLumen()
  const [query, setQuery] = useState('')
  const [chapterCount, setChapterCount] = useState<number | null>(null)

  const book = active?.book
  const bookId = book?.id

  useEffect(() => {
    if (!bookId || !open) return
    let cancelled = false
    // Chapter titles are stored with the converted text in IndexedDB. Reading
    // only the count keeps this cheap; the picker works off chapter indices
    // and the book's own chapter total.
    getBook(bookId)
      .then(stored => {
        if (!cancelled) setChapterCount(stored?.chapters.length ?? 0)
      })
      .catch(() => {
        if (!cancelled) setChapterCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [bookId, open])

  const indices = useMemo(() => {
    const total = chapterCount ?? 0
    const needle = query.trim()
    return Array.from({ length: total }, (_, index) => index).filter(index =>
      needle ? `第 ${index + 1} 章`.includes(needle) : true,
    )
  }, [chapterCount, query])

  if (!book || !active) return null

  return (
    <Sheet open={open} title="阅读范围" onClose={onClose}>
      <div className="-mx-4">
        <div className="px-4 pb-2">
          <p className="truncate text-[15px] font-medium">{book.title}</p>
          <p className="mt-0.5 text-[13px] text-quiet">
            {book.chapterCount} 章
            {book.unreadable ? ` · ${book.unreadable} 节未提取正文` : ''}
          </p>
        </div>

        {(chapterCount ?? 0) > 8 ? (
          <label className="mx-4 mb-3 flex h-9 items-center gap-2 rounded-[10px] bg-field px-2.5">
            <Icon name="search" size={16} className="text-quiet" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索章号"
              aria-label="搜索章号"
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-quiet"
            />
          </label>
        ) : null}

        <div className="scroll-pane max-h-[52dvh] overflow-hidden overflow-y-auto bg-surface hairline-t hairline-b">
          <Row
            icon="book"
            label="整本分析"
            value={`${book.chapterCount} 章`}
            selected={book.focusChapter == null}
            onClick={() => {
              updateConversation(active.id, { book: { ...book, focusChapter: null } })
              onClose()
            }}
          />
          {indices.map(index => (
            <Row
              key={index}
              label={`第 ${index + 1} 章`}
              selected={book.focusChapter === index}
              onClick={() => {
                updateConversation(active.id, { book: { ...book, focusChapter: index } })
                onClose()
              }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            updateConversation(active.id, { book: undefined })
            onClose()
          }}
          className="mx-4 mt-4 w-[calc(100%-2rem)] rounded-[14px] bg-surface py-3.5 text-center text-[17px] text-danger active:opacity-60"
        >
          移除书籍
        </button>
      </div>
    </Sheet>
  )
}
