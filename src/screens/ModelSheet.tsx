import { useEffect, useMemo, useState } from 'react'
import { Sheet } from '@/components/Sheet'
import { Row } from '@/components/List'
import { Icon, IconButton } from '@/components/Icon'
import { useLumen } from '@/state/LumenContext'
import { getBook } from '@/lib/store'
import { cn } from '@/lib/cn'
import { REASONING_LABELS } from '@/lib/api'

const outputPresets = [1024, 4096, 8192, 16384, 32768, 65536]

export function ModelSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { active, models, model, setModel, modelStatus, refreshModels, settings, updateSettings } = useLumen()
  const [query, setQuery] = useState('')
  const searchable = models.length > 8
  const selected = models.find(item => item.id === active?.model) ?? models.find(item => item.id === model) ?? models[0]
  const selectedEffort = selected?.reasoningOptions.find(level => level === settings.reasoningByModel?.[selected.id])
  const output = settings.outputTokenLimit === 'max' && !selected?.outputTokens ? '' : settings.outputTokenLimit ?? ''
  const selectClass = 'min-h-10 max-w-[56%] rounded-md bg-field px-2 text-[16px] text-ink'

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

        {selected ? (
          <div className="mx-4 mb-4 divide-y divide-(--separator) rounded-[16px] bg-surface px-3">
            <label className="flex min-h-[52px] items-center justify-between gap-3">
              <span className="text-[14px] font-medium">思考强度</span>
              <select
                className={selectClass}
                value={selectedEffort ?? ''}
                disabled={!selected.reasoningOptions.length}
                onChange={event => updateSettings({
                  reasoningByModel: { ...settings.reasoningByModel, [selected.id]: event.target.value },
                })}
              >
                <option value="">{selected.reasoningOptions.length ? '模型默认' : '暂无可调档位'}</option>
                {selected.reasoningOptions.map(level => (
                  <option key={level} value={level}>{REASONING_LABELS[level]}</option>
                ))}
              </select>
            </label>
            <label className="flex min-h-[52px] items-center justify-between gap-3">
              <span className="text-[14px] font-medium">输出上限</span>
              <select
                className={selectClass}
                value={output}
                onChange={event => {
                  const value = event.target.value
                  updateSettings({ outputTokenLimit: !value ? null : value === 'max' ? value : Number(value) })
                }}
              >
                <option value="">自动</option>
                {outputPresets.map(limit => (
                  <option key={limit} value={limit}>{`${limit.toLocaleString()} tokens`}</option>
                ))}
                {selected.outputTokens ? <option value="max">模型上限</option> : null}
              </select>
            </label>
            <p className="py-2 text-[12px] text-quiet">
              {selected.outputTokens ? `最高支持 ${selected.outputTokens.toLocaleString()} tokens。` : ''}
              {active?.book ? '读书问答会预留书籍上下文。' : '上限受剩余上下文约束。'}
            </p>
          </div>
        ) : null}

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
              const picked = option.id === selected?.id
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
  const [stored, setStored] = useState<Awaited<ReturnType<typeof getBook>>>(null)
  const [loading, setLoading] = useState(false)

  const book = active?.book

  useEffect(() => {
    if (!book || !open) return
    let cancelled = false
    setQuery('')
    setStored(null)
    setLoading(true)
    getBook(book)
      .then(result => { if (!cancelled) setStored(result) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
    }
  }, [book, open])

  const chapters = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (stored?.chapters ?? []).map((chapter, index) => ({
      index, label: `第 ${index + 1} 章`, chapter,
    })).filter(item => `${item.label} ${item.chapter.title}`.toLowerCase().includes(needle))
  }, [stored, query])

  if (!book || !active) return null

  function download() {
    if (!stored) return
    const source = [
      `# ${stored.meta.title}`,
      stored.meta.author,
      ...stored.chapters.map((chapter, index) => `## 第 ${index + 1} 章 · ${chapter.title}\n\n${chapter.text}`),
    ].filter(Boolean).join('\n\n')
    const url = URL.createObjectURL(new Blob([source], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${stored.meta.title.replace(/[/\\]/g, '_')}.md`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  return (
    <Sheet open={open} title="阅读范围" onClose={onClose}>
      <div className="-mx-4">
        <div className="px-4 pb-2">
          <p className="truncate text-[15px] font-medium">{book.title}</p>
          <p className="mt-0.5 text-[13px] text-quiet">
            {stored?.chapters.length ?? book.chapterCount} 章
            {book.unreadable ? ` · ${book.unreadable} 节未提取正文` : ''}
          </p>
        </div>

        {(stored?.chapters.length ?? 0) > 8 ? (
          <label className="mx-4 mb-3 flex h-9 items-center gap-2 rounded-[10px] bg-field px-2.5">
            <Icon name="search" size={16} className="text-quiet" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索章节或章号"
              aria-label="搜索章节或章号"
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-quiet"
            />
          </label>
        ) : null}

        {stored ? <div className="scroll-pane max-h-[52dvh] overflow-hidden overflow-y-auto bg-surface hairline-t hairline-b">
          <Row
            icon="book"
            label="整本分析"
            value={`${stored.chapters.length} 章`}
            selected={book.focusChapter == null}
            onClick={() => {
              updateConversation(active.id, { book: { ...book, focusChapter: null } })
              onClose()
            }}
          />
          {chapters.map(({ index, label, chapter }) => (
            <Row
              key={index}
              label={label}
              detail={chapter.title}
              selected={book.focusChapter === index}
              onClick={() => {
                updateConversation(active.id, { book: { ...book, focusChapter: index } })
                onClose()
              }}
            />
          ))}
        </div> : (
          <p role="status" className="px-4 py-3 text-[13px] text-quiet">
            {loading ? '正在读取章节…' : '本设备没有这本书的正文，请重新上传 EPUB。'}
          </p>
        )}

        {stored ? <button
          type="button"
          onClick={download}
          className="mx-4 mt-4 w-[calc(100%-2rem)] rounded-[14px] bg-surface py-3.5 text-center text-[15px] text-brand"
        >
          下载 Markdown
        </button> : null}

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
