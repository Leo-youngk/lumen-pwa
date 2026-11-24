import { useState } from 'react'
import { Composer } from '@/components/Composer'
import { Icon } from '@/components/Icon'
import { GlassButton, NavigationBar } from '@/components/NavigationBar'
import { useLumen } from '@/state/LumenContext'

export interface HomeScreenProps {
  onOpenDrawer: () => void
  onOpenModels: () => void
  onNew: () => void
  onUpload: (file: File) => void
  uploading: boolean
  onSent: () => void
}

/**
 * New-conversation screen.
 *
 * Structure follows the assistant-app convention rather than a generic landing
 * page: a single question mark as the headline, one field, nothing else. The
 * block sits slightly above the optical centre — centring it exactly makes the
 * lower half read as unfinished rather than as breathing room.
 */
export function HomeScreen({
  onOpenDrawer,
  onOpenModels,
  onNew,
  onUpload,
  uploading,
  onSent,
}: HomeScreenProps) {
  const { send, model, modelLabel, models, streaming, settings } = useLumen()
  const [draft, setDraft] = useState('')

  return (
    <div className="screen-enter relative h-full min-h-0">
      <NavigationBar
        showTitle={false}
        leading={<GlassButton icon="menu" label="打开对话列表" onClick={onOpenDrawer} badge />}
        trailing={<GlassButton icon="compose" label="新对话" onClick={onNew} />}
      />

      <div className="scroll-pane h-full" style={{ paddingTop: 'var(--nav-height)' }}>
        <div
          className="mx-auto flex min-h-full w-full max-w-[680px] flex-col justify-center px-4"
          style={{ paddingBottom: 'calc(var(--safe-bottom) + 16vh)' }}
        >
          <h1 className="mb-8 text-center text-[24px] leading-tight font-medium tracking-[-0.01em] text-ink">
            有什么可以帮你？
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
            enterToSend={settings.enterToSend}
            placeholder={uploading ? '正在转换 EPUB…' : '问点什么…'}
            docked={false}
          />

          <div className="mt-3 flex justify-center">
            <div className="rounded-full bg-field px-1">
              <ModelPill label={models.length ? modelLabel(model) : '模型'} onClick={onOpenModels} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ModelPill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="inline-flex h-8 max-w-[40vw] items-center gap-0.5 rounded-full px-1.5 text-[13px] text-quiet transition-colors duration-150 active:bg-(--separator)"
    >
      <span className="truncate">{label}</span>
      <Icon name="down" size={11} strokeWidth={2.4} className="shrink-0" />
    </button>
  )
}
