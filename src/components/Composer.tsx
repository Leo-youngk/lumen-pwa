import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
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
  /** Rendered above the field: scope pill, status text, upload errors. */
  leading?: React.ReactNode
  context?: React.ReactNode
  inputRef?: RefObject<HTMLTextAreaElement | null>
  /** Slot left of the field's action row, e.g. an attach button. */
  accessory?: React.ReactNode
  /** Trailing control left of the send button, e.g. the model pill. */
  trailing?: React.ReactNode
  onAttach?: (file: File) => void
  attachLabel?: string
  className?: string
  /**
   * Docked composers pad for the keyboard and sit on the panel edge; a floating
   * one is centred mid-screen on the home screen and needs neither.
   */
  docked?: boolean
}

/**
 * The message composer.
 *
 * iOS conventions this follows:
 *
 * - It is a rounded field with an action row inside it, not a bordered input
 *   with a send button hanging off the right edge.
 * - The textarea grows to a ceiling (112 px ≈ 4 lines) and then scrolls, so
 *   the dock never swallows the conversation.
 * - Enter sends, Shift+Enter breaks the line, and IME composition is respected
 *   so that confirming a Chinese candidate does not fire a send.
 * - The app viewport keeps the dock above the keyboard.
 */
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
  inputRef,
  accessory,
  trailing,
  onAttach,
  attachLabel = '上传书籍',
  className,
  docked = true,
}: ComposerProps) {
  const localField = useRef<HTMLTextAreaElement>(null)
  const field = inputRef ?? localField
  const upload = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)

  // Publish the dock's height so the transcript can pad for it and still scroll
  // *under* the bar. Without content sliding beneath, the glass has nothing to
  // refract and the bar reads as a plain white strip.
  useEffect(() => {
    const element = root.current
    if (!element) return
    const apply = () => {
      document.documentElement.style.setProperty('--composer-height', `${element.offsetHeight}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const ready = value.trim().length > 0 && !disabled && !streaming

  // Size the textarea to its content, capped so it scrolls instead of growing.
  useLayoutEffect(() => {
    const node = field.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(112, Math.max(24, node.scrollHeight))}px`
  }, [field, value])

  const submit = useCallback(() => {
    if (!ready) return
    onSubmit(value.trim())
  }, [onSubmit, ready, value])

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    // `isComposing` guards IME candidate selection.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (!enterToSend && !event.metaKey && !event.ctrlKey) return
    event.preventDefault()
    submit()
  }

  function pickFile(file: File | undefined) {
    if (!file || !onAttach || disabled || streaming) return
    onAttach(file)
  }

  return (
    <div
      ref={root}
      className={cn('relative shrink-0 px-3', docked && 'pb-2.5', className)}
    >
      {leading}
      {context ? <div className="mb-2 px-1">{context}</div> : null}

      <form
        onSubmit={event => {
          event.preventDefault()
          submit()
        }}
        onDragEnter={event => {
          if (!onAttach || !Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={event => {
          if (!onAttach || !Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (!dragDepth.current) setDragging(false)
        }}
        onDrop={event => {
          if (!onAttach || !event.dataTransfer.files.length) return
          event.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          pickFile(event.dataTransfer.files[0])
        }}
        className={cn(
          'relative flex items-end gap-1.5 rounded-[28px] px-2 py-2',
          'glass-field',
          'transition-[box-shadow] duration-200 ease-(--ease-enter)',
          dragging && 'ring-2 ring-brand/40',
        )}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[28px] bg-brand-soft/80 text-[15px] font-medium text-brand-ink">
            松开以上传 EPUB
          </div>
        ) : null}

        {onAttach ? (
          <>
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
              label={attachLabel}
              onClick={() => upload.current?.click()}
              disabled={disabled || streaming}
              className="ml-0 size-9 text-secondary"
            />
          </>
        ) : (
          accessory
        )}

        <textarea
          ref={field}
          rows={1}
          value={value}
          aria-label="输入消息"
          placeholder={placeholder}
          onChange={event => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          enterKeyHint={enterToSend ? 'send' : 'enter'}
          className={cn(
            'max-h-28 min-h-[24px] flex-1 resize-none bg-transparent py-1.5 text-[16px] leading-[1.4]',
            'outline-none placeholder:text-quiet',
          )}
        />

        <div className="flex shrink-0 items-center gap-1">
          {trailing}
          <button
            type={streaming ? 'button' : 'submit'}
            onClick={streaming ? onStop : undefined}
            disabled={!streaming && !ready}
            aria-label={streaming ? '停止生成' : '发送'}
            className={cn(
              'grid size-9 place-items-center rounded-full',
              'transition-[transform,background-color,opacity] duration-150 ease-(--ease-tap) active:scale-90',
              streaming
                ? 'bg-ink text-canvas'
                : ready
                  ? 'bg-brand text-brand-contrast'
                  : 'text-quiet opacity-60',
            )}
          >
            <Icon
              name={streaming ? 'stop' : 'send'}
              size={streaming ? 16 : 19}
              strokeWidth={streaming ? 0 : 2.2}
              className={streaming ? 'fill-current' : undefined}
            />
          </button>
        </div>
      </form>
    </div>
  )
}
