import { useCallback, useRef, useState } from 'react'
import { BarButton, CollapsingLargeTitle, NavigationBar } from '@/components/NavigationBar'
import { List, Row } from '@/components/List'
import { Sheet } from '@/components/Sheet'
import { useLumen } from '@/state/LumenContext'
import { cn } from '@/lib/cn'
import type { ThemeName } from '@/lib/store'

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'mono', label: '单色' },
  { value: 'cream', label: '米色' },
]

export function SettingsScreen({
  onBack,
  onOpenModels,
}: {
  onBack: () => void
  onOpenModels: () => void
}) {
  const { settings, updateSettings, resetSettings, usage, model, modelLabel, modelStatus, refreshModels } =
    useLumen()
  const [themeSheet, setThemeSheet] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const onCollapse = useCallback((value: boolean) => setCollapsed(value), [])

  const themeLabel = THEMES.find(item => item.value === settings.theme)?.label ?? '浅色'

  return (
    <div className="relative h-full min-h-0">
      <NavigationBar
        title="设置"
        collapsed={collapsed}
        onBack={onBack}
        trailing={
          <BarButton bold onClick={onBack}>
            完成
          </BarButton>
        }
      />

      <div
        ref={scroll}
        className="scroll-pane h-full"
        style={{ paddingTop: 'var(--nav-height)' }}
      >
        <div className="mx-auto w-full max-w-[720px] px-1 pt-2">
          <CollapsingLargeTitle title="设置" scrollRef={scroll} onChange={onCollapse} />

          <div className="px-4">
            <List header="外观">
              <Row icon="sliders" label="主题" value={themeLabel} onClick={() => setThemeSheet(true)} />
              <ToggleRow
                label="紧凑排版"
                detail="减少消息之间的间距"
                checked={settings.compactMode}
                onChange={value => updateSettings({ compactMode: value })}
              />
            </List>

            <List header="阅读" footer="正文字号会影响回答的显示大小。">
              <SliderRow
                label="正文字号"
                value={settings.fontSize}
                min={13}
                max={21}
                step={1}
                unit="px"
                onChange={value => updateSettings({ fontSize: value })}
              />
              <SliderRow
                label="行高"
                value={settings.lineHeight}
                min={1.4}
                max={2.1}
                step={0.05}
                unit=""
                onChange={value => updateSettings({ lineHeight: value })}
              />
            </List>

            <List header="模型与服务">
              <Row
                icon="provider"
                label="模型服务"
                detail={settings.apiBaseUrl.trim() ? '自定义接口' : 'OpenCode Go'}
                value={modelStatus.state === 'ready' ? '已连接' : modelStatus.state === 'loading' ? '连接中' : '未连接'}
              />
              <Row
                icon="chip"
                tone="blue"
                label="默认模型"
                value={modelLabel(model)}
                onClick={onOpenModels}
              />
              <Row
                icon="refresh"
                label="刷新模型列表"
                onClick={refreshModels}
                detail={modelStatus.state === 'error' ? modelStatus.message : undefined}
              />
            </List>

            <List header="输入">
              <ToggleRow
                label="回车发送"
                detail="关闭后用 ⌘+回车 发送"
                checked={settings.enterToSend}
                onChange={value => updateSettings({ enterToSend: value })}
              />
            </List>

            <List
              header="用量"
              footer={
                usage.unreported
                  ? `另有 ${usage.unreported} 次请求未返回用量。数据只统计在本设备上。`
                  : '数据只统计在本设备上。'
              }
            >
              <Row icon="usage" tone="teal" label="累计 Token" value={formatTokens(usage.total)} />
              <Row label="输入" value={formatTokens(usage.input)} />
              <Row label="输出" value={formatTokens(usage.output)} />
            </List>

            <List header="高级" footer="自定义接口通过 Lumen 的 Worker 连接模型服务。">
              <Row
                icon="provider"
                label="自定义接口与 API Key"
                onClick={() => setAdvanced(true)}
                chevron
              />
              <Row icon="sliders" tone="orange" label="恢复默认外观" onClick={resetSettings} />
            </List>

            <p className="px-2 pb-8 text-center text-[12.5px] text-quiet">Lumen · 本地优先的阅读对话工作台</p>
          </div>
        </div>
      </div>

      <Sheet open={themeSheet} title="主题" onClose={() => setThemeSheet(false)}>
        <div className="-mx-4">
          <List>
            {THEMES.map(item => (
              <Row
                key={item.value}
                label={item.label}
                selected={settings.theme === item.value}
                onClick={() => {
                  updateSettings({ theme: item.value })
                  setThemeSheet(false)
                }}
              />
            ))}
          </List>
        </div>
      </Sheet>

      <AdvancedSheet open={advanced} onClose={() => setAdvanced(false)} onConnected={onOpenModels} />
    </div>
  )
}

function ToggleRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string
  detail?: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] leading-tight">{label}</span>
        {detail ? <span className="mt-0.5 block text-[13px] leading-tight text-quiet">{detail}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200',
          'bg-(--separator-strong) peer-checked:bg-brand',
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand",
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/25%)]',
            'transition-transform duration-200 ease-(--ease-spring)',
            checked && 'translate-x-[20px]',
          )}
        />
      </span>
    </label>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[16px]">{label}</span>
        <span className="font-mono text-[13px] text-quiet">
          {step < 1 ? value.toFixed(2) : value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        aria-label={label}
        className="h-1.5 w-full appearance-none rounded-full bg-(--separator-strong) accent-brand"
      />
    </div>
  )
}

function AdvancedSheet({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected: () => void }) {
  const { settings, connectProvider } = useLumen()
  const [base, setBase] = useState(settings.apiBaseUrl)
  const [key, setKey] = useState(settings.apiKey)
  const [message, setMessage] = useState('')
  const [connecting, setConnecting] = useState(false)
  const showModelsOnDismiss = useRef(false)

  async function save() {
    if (connecting) return
    const apiBaseUrl = base.trim()
    const apiKey = key.trim().replace(/^Bearer\s+/i, '')
    if (apiBaseUrl && (!/^https:\/\//i.test(apiBaseUrl) || !apiKey)) {
      setMessage('请填写以 https:// 开头的地址，以及该服务的 API Key。')
      return
    }
    setMessage('')
    setConnecting(true)
    try {
      await connectProvider(apiBaseUrl, apiKey)
      showModelsOnDismiss.current = true
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法连接模型服务。')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Sheet open={open} title="自定义接口" onClose={onClose} onDismissed={() => {
      if (!showModelsOnDismiss.current) return
      showModelsOnDismiss.current = false
      onConnected()
    }}>
      <div className="space-y-4 pb-2">
        <label className="block">
          <span className="section-label mb-1.5 block">接口地址</span>
          <input
            type="url"
            value={base}
            onChange={event => setBase(event.target.value)}
            placeholder="OpenCode Go 留空"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 w-full rounded-[11px] bg-field px-3 text-[16px] outline-none placeholder:text-quiet"
          />
        </label>
        <label className="block">
          <span className="section-label mb-1.5 block">API Key</span>
          <input
            type="password"
            value={key}
            onChange={event => setKey(event.target.value)}
            autoComplete="off"
            className="h-11 w-full rounded-[11px] bg-field px-3 text-[16px] outline-none"
          />
        </label>
        <p className="text-[13px] leading-relaxed text-quiet">
          OpenCode Go 的接口地址留空即可。Key 从订阅所在工作区的个人 API Keys 中复制。
        </p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={connecting}
          className="h-11 w-full rounded-[12px] bg-brand text-[16px] font-medium text-white active:opacity-80"
        >
          {connecting ? '正在获取模型…' : '连接并选择模型'}
        </button>
        {message ? <p role="alert" className="text-center text-[13px] text-quiet">{message}</p> : null}
      </div>
    </Sheet>
  )
}

function formatTokens(value: number): string {
  if (!value) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return String(value)
}
