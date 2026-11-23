import { useCallback, useState } from 'react'
import { ChatScreen } from '@/screens/ChatScreen'
import { HistoryScreen } from '@/screens/HistoryScreen'
import { HomeScreen } from '@/screens/HomeScreen'
import { ModelSheet, ScopeSheet } from '@/screens/ModelSheet'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { SignInScreen } from '@/screens/SignInScreen'
import { Sheet } from '@/components/Sheet'
import { List, Row } from '@/components/List'
import { LumenClient } from '@/lib/api'
import { newId, putBook } from '@/lib/store'
import { useLumen } from '@/state/LumenContext'
import { useTheme, useViewport } from '@/lib/viewport'
import { useServiceWorker } from '@/lib/useServiceWorker'
import { cn } from '@/lib/cn'

type Route = 'home' | 'chat' | 'history' | 'settings'

export function App() {
  const { status, settings, activeId, startConversation, clearAll, deleteConversation } =
    useLumen()
  const [route, setRoute] = useState<Route>('home')
  const [models, setModels] = useState(false)
  const [scope, setScope] = useState(false)
  const [options, setOptions] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  useViewport()
  useTheme(settings.theme)
  useServiceWorker()

  const openChat = useCallback((id: string) => {
    setRoute('chat')
    void id
  }, [])

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    setUploadError('')
    try {
      const client = new LumenClient()
      const result = await client.uploadEpub(file)
      const id = newId()
      await putBook(
        {
          id,
          title: result.title,
          chapterCount: result.chapterCount,
          charCount: result.markdown.length,
          unreadable: result.unreadable,
          markdown: result.markdown,
          focusChapter: null,
        },
        result.markdown ? [result.markdown] : [],
      )
      startConversation({
        title: result.title,
        book: {
          id,
          title: result.title,
          chapterCount: result.chapterCount,
          charCount: result.markdown.length,
          unreadable: result.unreadable,
          markdown: result.markdown,
          focusChapter: null,
        },
      })
      setRoute('chat')
    } catch (failure) {
      setUploadError(failure instanceof Error ? failure.message : 'EPUB 解析失败。')
    } finally {
      setUploading(false)
    }
  }, [startConversation])

  if (status === 'checking') {
    return (
      <div className="app-frame grid place-items-center bg-canvas">
        <div className="flex items-center gap-2 text-[14px] text-quiet">
          <span className="size-3.5 animate-spin rounded-full border-2 border-(--separator-strong) border-t-brand" />
          正在确认会话
        </div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <div className="app-frame bg-canvas">
        <div className="app-panel mx-auto max-w-[420px]">
          <SignInScreen />
        </div>
      </div>
    )
  }

  return (
    <div className="app-frame bg-canvas">
      {/* One rounded panel holding the whole app, inset from the window. The
          sidebar and screens live inside it so every surface shares the same
          corner radius and the canvas only appears in the gap around it. */}
      <div className="app-panel mx-auto flex max-w-[1100px]">
        <Sidebar route={route} onNavigate={setRoute} onHistory={() => setRoute('history')} />

        <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          {route === 'home' ? (
            <HomeScreen
              onOpenHistory={() => setRoute('history')}
              onOpenSettings={() => setRoute('settings')}
              onOpenModels={() => setModels(true)}
              onUpload={file => void upload(file)}
              uploading={uploading}
              onOpenScope={() => setScope(true)}
              onSent={() => setRoute('chat')}
            />
          ) : null}

          {route === 'chat' && activeId ? (
            <ChatScreen
              onBack={() => setRoute('home')}
              onOpenOptions={() => setOptions(true)}
              onOpenModels={() => setModels(true)}
              onOpenScope={() => setScope(true)}
              onUpload={file => void upload(file)}
            />
          ) : null}

          {route === 'chat' && !activeId ? (
            <div className="grid h-full place-items-center px-8 text-center">
              <div>
                <p className="text-[16px] font-medium">还没有选择对话</p>
                <button
                  type="button"
                  onClick={() => setRoute('home')}
                  className="mt-3 rounded-full bg-brand px-4 py-2 text-[15px] text-white active:opacity-80"
                >
                  回到首页
                </button>
              </div>
            </div>
          ) : null}

          {route === 'history' ? (
            <HistoryScreen onBack={() => setRoute('home')} onOpen={openChat} />
          ) : null}

          {route === 'settings' ? (
            <SettingsScreen onBack={() => setRoute('home')} onOpenModels={() => setModels(true)} />
          ) : null}
        </main>
      </div>

      <ModelSheet open={models} onClose={() => setModels(false)} />
      <ScopeSheet open={scope} onClose={() => setScope(false)} />

      <Sheet open={options} title="对话选项" onClose={() => setOptions(false)}>
        <div className="-mx-4">
          <List>
            <Row
              icon="plus"
              label="新对话"
              onClick={() => {
                startConversation()
                setRoute('home')
                setOptions(false)
              }}
            />
            <Row
              icon="settings"
              label="设置"
              onClick={() => {
                setRoute('settings')
                setOptions(false)
              }}
            />
          </List>
          {activeId ? (
            <button
              type="button"
              onClick={() => {
                deleteConversation(activeId)
                setRoute('home')
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
              setRoute('home')
              setOptions(false)
            }}
            className="mx-4 w-[calc(100%-2rem)] py-2 text-center text-[13px] text-quiet active:opacity-50"
          >
            清空全部对话
          </button>
        </div>
      </Sheet>

      {uploadError ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4">
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
  onHistory,
}: {
  route: Route
  onNavigate: (route: Route) => void
  onHistory: () => void
}) {
  const { conversations, openConversation, startConversation, activeId } = useLumen()

  return (
    <aside
      aria-label="对话导航"
      className="hidden w-[268px] shrink-0 flex-col border-r border-(--separator) bg-sidebar lg:flex"
    >
      <div className="flex items-center gap-2 px-4 pt-4 pb-3" style={{ paddingTop: 'calc(var(--safe-top) + 14px)' }}>
        <span className="size-7 rounded-[8px] bg-[radial-gradient(120%_120%_at_28%_18%,#d9e9df_0%,#a9c9b8_38%,#4f7f6c_74%,#2b4f42_100%)]" />
        <span className="text-[16px] font-semibold tracking-tight">Lumen</span>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => {
            startConversation()
            onNavigate('home')
          }}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[9px] bg-surface text-[14px] font-medium hairline-t hairline-b active:opacity-70"
        >
          <span className="text-[17px] leading-none">+</span> 新对话
        </button>
      </div>

      <nav className="scroll-pane mt-4 min-h-0 flex-1 px-2">
        {conversations.length ? (
          <>
            <p className="section-label mb-1.5 px-2 text-[11px]">最近对话</p>
            {conversations.slice(0, 20).map(conversation => (
              <button
                key={conversation.id}
                type="button"
                aria-current={conversation.id === activeId ? 'page' : undefined}
                onClick={() => {
                  openConversation(conversation.id)
                  onNavigate('chat')
                }}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13.5px]',
                  conversation.id === activeId
                    ? 'bg-(--glass-chrome) text-ink'
                    : 'text-secondary hover:bg-(--separator)',
                )}
              >
                <span className="truncate">{conversation.title}</span>
              </button>
            ))}
          </>
        ) : (
          <p className="px-2 text-[13px] text-quiet">还没有对话</p>
        )}
      </nav>

      <div className="border-t border-(--separator) p-2">
        <SidebarLink active={route === 'history'} onClick={onHistory}>
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
