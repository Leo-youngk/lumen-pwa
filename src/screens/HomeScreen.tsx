import { useState } from 'react'
import { Composer } from '@/components/Composer'
import { Icon, IconButton } from '@/components/Icon'
import { NavigationBar } from '@/components/NavigationBar'
import { useLumen } from '@/state/LumenContext'

export interface HomeScreenProps {
  onOpenHistory: () => void
  onOpenSettings: () => void
  onOpenModels: () => void
  onUpload: (file: File) => void
  uploading: boolean
  onSent: () => void
}

export function HomeScreen({
  onOpenHistory,
  onOpenSettings,
  onOpenModels,
  onUpload,
  uploading,
  onSent,
}: HomeScreenProps) {
  const { send, model, modelLabel, models, streaming, settings } = useLumen()
  const [draft, setDraft] = useState('')

  return (
    <div className="relative h-full min-h-0">
      <NavigationBar
        divider={false}
        collapsed={false}
        leading={<IconButton icon="history" label="打开历史" onClick={onOpenHistory} />}
        trailing={<IconButton icon="settings" label="设置" onClick={onOpenSettings} />}
      />

      <div className="scroll-pane h-full" style={{ paddingTop: 'var(--nav-height)' }}>
        <div className="mx-auto flex min-h-full w-full max-w-[648px] flex-col justify-center px-1 py-5">
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
            trailing={
              <ModelPill label={models.length ? modelLabel(model) : '模型'} onClick={onOpenModels} />
            }
          />
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
