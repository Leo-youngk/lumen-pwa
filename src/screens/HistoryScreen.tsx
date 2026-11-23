import { useCallback, useMemo, useRef, useState } from 'react'
import { Icon, IconButton, Tile } from '@/components/Icon'
import { CollapsingLargeTitle, NavigationBar } from '@/components/NavigationBar'
import { Sheet } from '@/components/Sheet'
import { Row, List } from '@/components/List'
import { useLumen } from '@/state/LumenContext'
import { cn } from '@/lib/cn'

export function HistoryScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  const { conversations, deleteConversation, toggleStar, startConversation } = useLumen()
  const [filter, setFilter] = useState<'all' | 'starred'>('all')
  const [menu, setMenu] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const onCollapse = useCallback((value: boolean) => setCollapsed(value), [])

  const visible = useMemo(
    () => (filter === 'starred' ? conversations.filter(item => item.starred) : conversations),
    [conversations, filter],
  )

  return (
    <div className="relative h-full min-h-0">
      <NavigationBar
        title="对话"
        collapsed={collapsed}
        onBack={onBack}
        trailing={
          <button
            type="button"
            onClick={() => {
              startConversation()
              onBack()
            }}
            className="h-11 px-2 text-[17px] font-semibold text-brand active:opacity-50"
          >
            新建
          </button>
        }
      />

      <div
        ref={scroll}
        className="scroll-pane h-full"
        style={{ paddingTop: 'var(--nav-height)' }}
      >
        <div className="mx-auto w-full max-w-[720px] px-1 pt-2">
          <CollapsingLargeTitle title="对话" scrollRef={scroll} onChange={onCollapse} />

          <div className="mb-4 px-4">
            <div className="flex rounded-[9px] bg-field p-0.5" role="tablist">
              {(
                [
                  ['all', '全部'],
                  ['starred', '收藏'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    'h-8 flex-1 rounded-[7px] text-[13px] font-medium transition-all duration-150',
                    filter === key
                      ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/10%)]'
                      : 'text-quiet',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {visible.length ? (
            <div className="px-4">
              <div className="overflow-hidden rounded-[15px] bg-surface hairline-t hairline-b">
                {visible.map((conversation, index) => (
                  <div
                    key={conversation.id}
                    className={cn('flex items-center', index > 0 && 'border-t border-(--separator)')}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(conversation.id)}
                      className="flex min-h-[56px] flex-1 items-center gap-3 py-2 pl-4 text-left active:bg-(--separator)"
                    >
                      <Tile icon="chat" tone={conversation.starred ? 'orange' : 'brand'} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] leading-tight">
                          {conversation.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] leading-tight text-quiet">
                          {formatWhen(conversation.updatedAt)} · {conversation.messages.length} 条消息
                        </span>
                      </span>
                    </button>
                    <IconButton
                      icon="more"
                      label={`${conversation.title} 的选项`}
                      variant="quiet"
                      onClick={() => setMenu(conversation.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyHistory starred={filter === 'starred'} />
          )}
        </div>
      </div>

      <Sheet open={Boolean(menu)} title="对话操作" onClose={() => setMenu(null)}>
        {menu ? (
          <div className="-mx-4">
            <List>
              <Row
                icon="star"
                tone="orange"
                label={conversations.find(item => item.id === menu)?.starred ? '取消收藏' : '收藏对话'}
                onClick={() => {
                  toggleStar(menu)
                  setMenu(null)
                }}
              />
            </List>
            <button
              type="button"
              onClick={() => {
                deleteConversation(menu)
                setMenu(null)
              }}
              className="mx-4 mb-2 w-[calc(100%-2rem)] rounded-[14px] bg-surface py-3.5 text-center text-[17px] text-danger active:opacity-60"
            >
              删除对话
            </button>
          </div>
        ) : null}
      </Sheet>
    </div>
  )
}

function EmptyHistory({ starred }: { starred: boolean }) {
  return (
    <div className="flex flex-col items-center px-8 pt-16 text-center">
      <span className="mb-3 grid size-12 place-items-center rounded-[14px] bg-field text-quiet">
        <Icon name="chat" size={24} />
      </span>
      <p className="text-[16px] font-medium">{starred ? '还没有收藏的对话' : '还没有对话'}</p>
      <p className="mt-1 text-[14px] leading-relaxed text-quiet">
        {starred ? '在对话的更多菜单里收藏重要的对话。' : '在首页问一个问题，就会出现在这里。'}
      </p>
    </div>
  )
}

/** Relative time in the style iOS uses in list subtitles. */
function formatWhen(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
