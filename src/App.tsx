import { Activity, useCallback, useRef, useState } from 'react'
import { ChatScreen } from '@/screens/ChatScreen'
import { HistoryScreen } from '@/screens/HistoryScreen'
import { ModelSheet, ScopeSheet } from '@/screens/ModelSheet'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { SignInScreen } from '@/screens/SignInScreen'
import { Sheet } from '@/components/Sheet'
import { SideDrawer } from '@/components/SideDrawer'
import { List, Row } from '@/components/List'
import { Icon } from '@/components/Icon'
import { LumenClient } from '@/lib/api'
import { isPinned, newId, putBook, sortConversations, type BookRecord } from '@/lib/store'
import { useLumen } from '@/state/LumenContext'
import { useTheme, useViewport } from '@/lib/viewport'
import { useServiceWorker } from '@/lib/useServiceWorker'
import { cn } from '@/lib/cn'

type Route = 'home' | 'chat' | 'history' | 'settings'

export function App() {
  const {
    status, retrySession, settings, active, activeId, streaming, openConversation, startConversation,
    updateConversation, togglePin, clearAll, deleteConversation, conversations,
  } = useLumen()
  const [route, setRoute] = useState<Route>('home')
  const [homeKey, setHomeKey] = useState(0)
  const navigationRevision = useRef(0)
  const [drawer, setDrawer] = useState(false)
  const [models, setModels] = useState(false)
  const [scope, setScope] = useState(false)
  const [options, setOptions] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadInFlight = useRef(false)
  const [uploadError, setUploadError] = useState('')

  useViewport()
  useTheme(settings.theme)
  useServiceWorker()

  const navigate = useCallback((next: Route) => {
    navigationRevision.current += 1
    if (next === 'home') openConversation(null)
    setRoute(next)
  }, [openConversation])

  const newConversation = useCallback(() => {
    setHomeKey(key => key + 1)
    navigate('home')
  }, [navigate])

  const openChat = useCallback((id: string) => {
    openConversation(id)
    navigate('chat')
  }, [navigate, openConversation])

  const upload = useCallback(async (file: File, targetId: string | null) => {
    if (uploadInFlight.current || streaming) return
    const revision = navigationRevision.current
    uploadInFlight.current = true
    setUploading(true)
    setUploadError('')
    try {
      const client = new LumenClient()
      const result = await client.uploadEpub(file)
      const book: BookRecord = {
        id: newId(),
        title: result.title || file.name.replace(/\.epub$/i, ''),
        author: result.author,
        chapterCount: result.chapters.length,
        charCount: result.charCount,
        unreadable: result.unreadable,
        missingSections: result.missingSections,
        focusChapter: null,
      }
      await putBook(book, result.chapters)
      if (targetId) {
        updateConversation(targetId, { book })
      } else {
        const stillOnHome = revision === navigationRevision.current
        startConversation({ title: book.title, book }, stillOnHome)
        if (stillOnHome) navigate('chat')
      }
    } catch (failure) {
      setUploadError(failure instanceof Error ? failure.message : 'EPUB 解析失败。')
    } finally {
      uploadInFlight.current = false
      setUploading(false)
    }
  }, [navigate, startConversation, streaming, updateConversation])

  if (status === 'checking') {
    return (
      <div className="app-frame grid place-items-center">
        <div role="status" className="flex items-center gap-2 text-[14px] text-quiet">
          <span className="size-3.5 animate-spin rounded-full border-2 border-(--separator-strong) border-t-brand" />
          正在确认会话
        </div>
      </div>
    )
  }

  if (status === 'unavailable') {
    return (
      <div className="app-frame grid place-items-center px-6 text-center">
        <div>
          <h1 className="text-[20px] font-semibold">暂时无法连接 Lumen</h1>
          <p className="mt-2 text-[15px] text-secondary">请检查网络连接，或稍后重试。</p>
          <button
            type="button"
            onClick={retrySession}
            className="mt-5 min-h-11 rounded-full bg-brand px-5 text-[15px] text-brand-contrast active:opacity-80"
          >
            重新连接
          </button>
        </div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <div className="app-frame">
        <div className="app-panel">
          <SignInScreen />
        </div>
      </div>
    )
  }

  return (
    <div className="app-frame">
      <div className="app-panel flex">
        <Sidebar route={route} onNavigate={navigate} onOpen={openChat} onNew={newConversation} />

        <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <Activity mode={route === 'home' || route === 'chat' ? 'visible' : 'hidden'}>
            <ChatScreen
              homeKey={homeKey}
              onOpenDrawer={() => setDrawer(true)}
              onOpenOptions={() => setOptions(true)}
              onOpenModels={() => setModels(true)}
              onOpenScope={() => setScope(true)}
              onNew={newConversation}
              onUpload={file => void upload(file, activeId)}
              uploading={uploading}
              onSent={() => navigate('chat')}
            />
          </Activity>

          {route === 'history' ? (
            <HistoryScreen onBack={() => navigate('home')} onNew={newConversation} onOpen={openChat} />
          ) : null}

          {route === 'settings' ? (
            <SettingsScreen onBack={() => navigate('home')} onOpenModels={() => setModels(true)} />
          ) : null}
        </main>
      </div>

      <ModelSheet open={models} onClose={() => setModels(false)} />
      <ScopeSheet open={scope} onClose={() => setScope(false)} />

      <SideDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        conversations={conversations}
        activeId={activeId}
        onOpen={openChat}
        onNew={newConversation}
        onSettings={() => navigate('settings')}
        onDelete={id => {
          deleteConversation(id)
          if (id === activeId) navigate('home')
        }}
      />

      <Sheet open={options} title="对话选项" onClose={() => setOptions(false)}>
        <div className="-mx-4">
          <List>
            <Row
              icon="plus"
              label="新对话"
              onClick={() => {
                newConversation()
                setOptions(false)
              }}
            />
            {active ? (
              <Row
                icon="pin"
                label={isPinned(active) ? '取消置顶' : '置顶对话'}
                onClick={() => {
                  togglePin(active.id)
                  setOptions(false)
                }}
              />
            ) : null}
            <Row
              icon="settings"
              label="设置"
              onClick={() => {
                navigate('settings')
                setOptions(false)
              }}
            />
          </List>
          {activeId ? (
            <button
              type="button"
              onClick={() => {
                deleteConversation(activeId)
                navigate('home')
                setOptions(false)
              }}
              className="mx-4 mb-2 w-[calc(100%-2rem)] rounded-[14px] bg-surface py-3.5 text-center text-[17px] text-danger active:opacity-60"
            >
              删除当前对话
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              clearAll()
              navigate('home')
              setOptions(false)
            }}
            className="mx-4 w-[calc(100%-2rem)] py-2 text-center text-[13px] text-quiet active:opacity-50"
          >
            清空全部对话
          </button>
        </div>
      </Sheet>

      {uploadError ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-40 flex justify-center px-4">
          <p
            role="alert"
            className="pointer-events-auto max-w-[420px] rounded-[12px] bg-accent-orange px-3.5 py-2.5 text-[13.5px] leading-snug text-accent-orange-ink shadow-lg"
            onClick={() => setUploadError('')}
          >
            {uploadError}
          </p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Desktop sidebar. On a phone it is hidden entirely: iOS has no persistent
 * side rail in a single-column app, and the nav bar's history button covers
 * the same job.
 */
function Sidebar({
  route,
  onNavigate,
  onOpen,
  onNew,
}: {
  route: Route
  onNavigate: (route: Route) => void
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const { conversations, activeId } = useLumen()

  return (
    <aside
      aria-label="对话导航"
      className="hidden w-[268px] shrink-0 flex-col border-r border-(--separator) bg-sidebar lg:flex"
    >
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-3">
        <span className="grid size-7 place-items-center rounded-[8px] bg-ink text-[13px] font-bold text-brand-contrast">L</span>
        <span className="text-[15px] font-semibold tracking-tight">Lumen</span>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={onNew}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[9px] bg-surface text-[14px] font-medium hairline-t hairline-b active:opacity-70"
        >
          <span className="text-[17px] leading-none">+</span> 新对话
        </button>
      </div>

      <nav className="scroll-pane mt-4 min-h-0 flex-1 px-2">
        {conversations.length ? (
          <>
            <p className="section-label mb-1.5 px-2 text-[11px]">对话</p>
            {sortConversations(conversations).slice(0, 20).map(conversation => (
              <button
                key={conversation.id}
                type="button"
                aria-current={conversation.id === activeId ? 'page' : undefined}
                onClick={() => onOpen(conversation.id)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13.5px]',
                  conversation.id === activeId
                    ? 'bg-(--glass-chrome) text-ink'
                    : 'text-secondary hover:bg-(--separator)',
                )}
              >
                {isPinned(conversation) ? <Icon name="pin" size={13} className="shrink-0 text-brand-ink" /> : null}
                <span className="truncate">{conversation.title}</span>
              </button>
            ))}
          </>
        ) : (
          <p className="px-2 text-[13px] text-quiet">还没有对话</p>
        )}
      </nav>

      <div className="border-t border-(--separator) p-2">
        <SidebarLink active={route === 'history'} onClick={() => onNavigate('history')}>
          全部对话
        </SidebarLink>
        <SidebarLink active={route === 'settings'} onClick={() => onNavigate('settings')}>
          设置
        </SidebarLink>
      </div>
    </aside>
  )
}

function SidebarLink({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center rounded-[7px] px-2 text-left text-[13.5px]',
        active ? 'bg-(--glass-chrome) text-ink' : 'text-secondary hover:bg-(--separator)',
      )}
    >
      {children}
    </button>
  )
}
