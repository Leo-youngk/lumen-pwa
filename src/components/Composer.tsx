import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { cn } from '@/lib/cn'
import { Icon, IconButton } from './Icon'

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onStop?: () => void
  streaming?: boolean
  disabled?: boolean
  enterToSend?: boolean
  placeholder?: string
  leading?: React.ReactNode
  context?: React.ReactNode
  inputRef: RefObject<HTMLTextAreaElement | null>
  onAttach: (file: File) => void
}

function fitField(node: HTMLTextAreaElement) {
  const scroll = node.scrollTop
  node.style.height = 'auto'
  // scrollHeight includes padding but excludes the 1px border on each side.
  node.style.height = `${node.scrollHeight + 2}px`
  node.scrollTop = scroll
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming = false,
  disabled = false,
  enterToSend = true,
  placeholder = '问 Lumen…',
  leading,
  context,
  inputRef: field,
  onAttach,
}: ComposerProps) {
  const upload = useRef<HTMLInputElement>(null)
  const isComposing = useRef(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const ready = value.trim().length > 0 && !disabled && !streaming

  useLayoutEffect(() => {
    const node = field.current
    if (node && !CSS.supports('field-sizing: content')) fitField(node)
  }, [field, value])

  useLayoutEffect(() => {
    const node = field.current
    const form = node?.form
    if (!node || !form || CSS.supports('field-sizing: content')) return
    let width: number | undefined
    let frame = 0
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width
      if (!next || next === width) return
      width = next
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitField(node))
    })
    observer.observe(form)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [field])

  function submit() {
    if (!ready || isComposing.current) return
    onSubmit(value.trim())
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (isComposing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (!enterToSend && !event.metaKey && !event.ctrlKey) return
    event.preventDefault()
    submit()
  }

  function pickFile(file: File | undefined) {
    if (!file || disabled || streaming) return
    onAttach(file)
  }

  return (
    <div className="composer-dock relative mx-auto w-full max-w-[680px] shrink-0">
      {leading}
      {context ? <div className="mb-2 px-1">{context}</div> : null}

      <form
        onSubmit={event => {
          event.preventDefault()
          submit()
        }}
        onDragEnter={event => {
          if (disabled || streaming || !Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={event => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (!dragDepth.current) setDragging(false)
        }}
        onDrop={event => {
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          pickFile(event.dataTransfer.files[0])
        }}
        className="relative flex items-end gap-2"
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-brand-soft/90 text-[15px] font-medium text-brand-ink">
            松开以上传 EPUB
          </div>
        ) : null}

        <input
          ref={upload}
          type="file"
          accept=".epub,application/epub+zip"
          hidden
          onChange={event => {
            pickFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <IconButton
          icon="plus"
          label="上传书籍"
          onClick={() => upload.current?.click()}
          disabled={disabled || streaming}
          className="size-11 shrink-0 border border-edge bg-transparent text-secondary"
        />

        <textarea
          ref={field}
          rows={1}
          value={value}
          aria-label="输入消息"
          placeholder={placeholder}
          onChange={event => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { isComposing.current = true }}
          onCompositionEnd={() => { isComposing.current = false }}
          autoComplete="off"
          enterKeyHint={enterToSend ? 'send' : 'enter'}
          className="composer-field min-w-0 flex-1 resize-none overscroll-contain rounded-[17px] border border-edge bg-field px-3 py-2.5 text-[16px] leading-[22px] placeholder:text-quiet"
        />

        <button
          type={streaming ? 'button' : 'submit'}
          onMouseDown={event => {
            if (document.activeElement === field.current) event.preventDefault()
          }}
          onClick={streaming ? onStop : undefined}
          disabled={!streaming && !ready}
          aria-label={streaming ? '停止生成' : '发送'}
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-full',
            'transition-[transform,background-color] duration-150 ease-(--ease-tap) active:scale-95',
            ready || streaming ? 'bg-brand text-brand-contrast' : 'bg-field text-quiet',
          )}
        >
          <Icon
            name={streaming ? 'stop' : 'send'}
            size={streaming ? 16 : 19}
            strokeWidth={streaming ? 0 : 2.2}
            className={streaming ? 'fill-current' : undefined}
          />
        </button>
      </form>
    </div>
  )
}
