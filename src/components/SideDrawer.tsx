import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { isPinned, type Conversation } from '@/lib/store'
import { Icon, Tile } from './Icon'

/**
 * Slide-out conversation drawer.
 *
 * The desktop rail (`Sidebar` in App.tsx) covers wide screens; on a phone the
 * list has to be reachable without leaving the conversation, which is what this
 * drawer is for. It follows the iOS drawer rules rather than a generic offcanvas
 * menu:
 *
 * - The scrim is a separate layer so the panel can be dragged while it is still
 *   visible underneath the finger.
 * - Dragging left past a third of the panel dismisses it; anything less snaps
 *   back. The transition is disabled during the drag so the panel tracks the
 *   finger instead of easing behind it.
 * - Only the horizontal component is claimed (`pan-y` stays with the list), so
 *   scrolling the conversation list never closes the drawer by accident.
 */

const DAY = 86_400_000

export function groupByDay(items: Conversation[]) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const today: Conversation[] = []
  const yesterday: Conversation[] = []
  const week: Conversation[] = []
  const older: Conversation[] = []

  for (const item of items) {
    const age = startOfToday - item.updatedAt
    if (item.updatedAt >= startOfToday) today.push(item)
    else if (age < DAY) yesterday.push(item)
    else if (age < 7 * DAY) week.push(item)
    else older.push(item)
  }

  return [
    { label: '今天', items: today },
    { label: '昨天', items: yesterday },
    { label: '7 天内', items: week },
    { label: '更早', items: older },
  ].filter((group) => group.items.length > 0)
}

export interface SideDrawerProps {
  open: boolean
  onClose: () => void
  conversations: Conversation[]
  activeId: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onSettings: () => void
  onDelete: (id: string) => void
}

export function SideDrawer({
  open,
  onClose,
  conversations,
  activeId,
  onOpen,
  onNew,
  onSettings,
  onDelete,
}: SideDrawerProps) {
  const panel = useRef<HTMLElement>(null)
  const drag = useRef<{ startX: number; dx: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function onTouchStart(event: React.TouchEvent) {
    drag.current = { startX: event.touches[0]?.clientX ?? 0, dx: 0 }
  }

  function onTouchMove(event: React.TouchEvent) {
    const state = drag.current
    const node = panel.current
    const x = event.touches[0]?.clientX
    if (!state || !node || x === undefined) return
    state.dx = Math.min(0, x - state.startX)
    node.style.transition = 'none'
    node.style.transform = `translate3d(${state.dx}px,0,0)`
  }

  function onTouchEnd() {
    const state = drag.current
    const node = panel.current
    drag.current = null
    if (!state || !node) return
    node.style.transition = ''
    node.style.transform = ''
    if (state.dx < -60) onClose()
  }

  const groups = groupByDay(conversations)

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 lg:hidden',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-(--scrim) transition-opacity duration-200 ease-(--ease-enter)',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />

      <aside
        ref={panel}
        role="dialog"
        aria-label="对话列表"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={cn(
          'absolute inset-y-0 left-0 flex w-[min(84vw,320px)] flex-col bg-sidebar',
          'border-r border-(--separator) shadow-[0_0_40px_rgb(0_0_0/18%)]',
          'transition-transform duration-250 ease-(--ease-enter)',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-[17px] font-semibold tracking-tight">对话</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭侧边栏"
            className="grid size-9 place-items-center rounded-full text-quiet active:bg-(--separator)"
          >
            <Icon name="close" size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => {
              onClose()
              onNew()
            }}
            className="flex h-10 w-full items-center gap-2 rounded-[10px] px-2 text-left text-[15px] font-medium transition-colors active:bg-(--separator)"
          >
            <Tile icon="compose" />
            <span className="truncate">新对话</span>
          </button>
        </div>

        <nav className="scroll-pane min-h-0 flex-1 px-2 pb-2">
          {groups.length === 0 ? (
            <p className="px-3 pt-6 text-[14px] text-quiet">还没有对话</p>
          ) : (
            groups.map((group) => (
              <section key={group.label} className="mb-3">
                <h3 className="section-label mb-1 px-2 text-[11px]">{group.label}</h3>
                {group.items.map((conversation) => {
                  const current = conversation.id === activeId
                  return (
                    <div key={conversation.id} className="group relative">
                      <button
                        type="button"
                        aria-current={current ? 'page' : undefined}
                        onClick={() => {
                          onOpen(conversation.id)
                          onClose()
                        }}
                        className={cn(
                          'flex h-10 w-full items-center gap-2 rounded-[9px] px-2 pr-9 text-left text-[15px]',
                          'transition-colors',
                          current ? 'bg-(--separator) text-ink' : 'text-secondary active:bg-(--separator)',
                        )}
                      >
                        {isPinned(conversation) ? (
                          <Icon name="pin" size={13} className="shrink-0 text-quiet" />
                        ) : null}
                        <span className="truncate">{conversation.title}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`删除「${conversation.title}」`}
                        onClick={() => onDelete(conversation.id)}
                        className={cn(
                          'absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-full',
                          'text-quiet opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
                          'active:bg-(--separator)',
                        )}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  )
                })}
              </section>
            ))
          )}
        </nav>

        <div className="border-t border-(--separator) p-2">
          <button
            type="button"
            onClick={() => {
              onClose()
              onSettings()
            }}
            className="flex h-10 w-full items-center gap-2 rounded-[9px] px-2 text-left text-[15px] text-secondary active:bg-(--separator)"
          >
            <Icon name="settings" size={19} strokeWidth={1.7} />
            设置
          </button>
        </div>
      </aside>
    </div>
  )
}
