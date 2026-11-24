import { useMemo } from 'react'
import { Tile } from '@/components/Icon'
import { NavigationBar } from '@/components/NavigationBar'
import { groupByDay } from '@/lib/time'
import { isPinned, sortConversations } from '@/lib/store'
import { useLumen } from '@/state/LumenContext'
import { cn } from '@/lib/cn'

export function HistoryScreen({ onBack, onOpen, onNew }: {
  onBack: () => void
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const { conversations } = useLumen()
  const groups = useMemo(() => groupByDay(sortConversations(conversations)), [conversations])

  return (
    <div className="screen-enter relative h-full min-h-0">
      <NavigationBar
        title="对话"
        onBack={onBack}
        trailing={
          <button
            type="button"
            onClick={onNew}
            className="h-11 px-2 text-[16px] font-semibold text-brand-ink active:opacity-50"
          >
            新建
          </button>
        }
      />

      <div className="scroll-pane h-full" style={{ paddingTop: 64 }}>
        {groups.length ? (
          <div className="mx-auto max-w-[680px] px-4 py-4">
            {groups.map(group => (
              <section key={group.label} className="mb-5">
                <h2 className="section-label mb-2 px-1">{group.label}</h2>
                <ul className="overflow-hidden rounded-[16px] bg-surface hairline-t hairline-b">
                  {group.items.map((conversation, index) => {
                    const pinned = isPinned(conversation)
                    return (
                      <li key={conversation.id} className={cn(index > 0 && 'border-t border-(--separator)')}>
                        <button
                          type="button"
                          onClick={() => onOpen(conversation.id)}
                          className="flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2 text-left active:bg-(--separator)"
                        >
                          <Tile icon={pinned ? 'pin' : 'chat'} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[16px] leading-tight">{conversation.title}</span>
                            <span className="mt-0.5 block truncate text-[13px] leading-tight text-quiet">
                              {formatWhen(conversation.updatedAt)} · {conversation.messages.length} 条消息
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="px-8 pt-12 text-center text-[15px] text-quiet">还没有对话</p>
        )}
      </div>
    </div>
  )
}

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
