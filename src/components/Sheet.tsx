import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { IconButton } from './Icon'

export interface SheetProps {
  open: boolean
  title?: string
  onClose: () => void
  onDismissed?: () => void
  children: ReactNode
  /** `models` and `tall` grow past the default half-height detent. */
  size?: 'default' | 'tall'
  className?: string
}

/**
 * A bottom sheet with native-feeling drag dismissal.
 *
 * Design notes, all of them load-bearing for the iOS impression:
 *
 * - It renders into a `<dialog>`'s top layer via `showModal()`, so focus
 *   trapping, ESC, the backdrop, and the `::backdrop` pseudo-element all come
 *   from the browser instead of hand-rolled portal plumbing.
 * - Dragging only starts from the grabber. Letting a drag that begins in the
 *   list body move the sheet fights the list's own scrolling, which is the
 *   single most common way a web sheet feels wrong.
 * - The sheet follows the finger 1:1 down to a soft limit, then applies
 *   resistance, and dismisses past ~30% of its height or on a fast flick.
 * - `data-state` drives the enter/exit transitions so the exit animation can
 *   finish before the dialog closes.
 */
export function Sheet({ open, title, onClose, onDismissed, children, size = 'default', className }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const [retained, setRetained] = useState(open)
  const titleId = useId()
  const dragState = useRef({ startY: 0, startTime: 0, offset: 0, active: false })
  const dismissedRef = useRef(onDismissed)
  dismissedRef.current = onDismissed

  useLayoutEffect(() => {
    const node = dialog.current
    if (!node) return
    if (open) {
      if (!node.open) {
        const focused = document.activeElement
        if (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) focused.blur()
        node.showModal()
      }
      setRetained(true)
    } else if (node.open) {
      const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
      const timer = window.setTimeout(() => {
        node.close()
        setRetained(false)
        dismissedRef.current?.()
      }, delay)
      return () => window.clearTimeout(timer)
    }
  }, [open])

  const finishDrag = useCallback(
    (velocity: number) => {
      const node = sheet.current
      if (!node) return
      const distance = dragState.current.offset
      const height = node.getBoundingClientRect().height || 1
      const travelled = distance / height
      // A flick down at >0.6 px/ms dismisses regardless of distance; otherwise
      // a third of the sheet is the threshold.
      const dismiss = travelled > 0.32 || (velocity > 0.6 && distance > 40)
      node.style.transition = ''
      node.style.transform = ''
      if (dismiss) {
        onClose()
      }
    },
    [onClose],
  )

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    dragState.current = {
      startY: event.clientY,
      startTime: performance.now(),
      offset: 0,
      active: true,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current
    const node = sheet.current
    if (!drag.active || !node) return
    const raw = Math.max(0, event.clientY - drag.startY)
    // Past 40% of the sheet the movement is compressed, which is what makes
    // an overshoot feel rubbery rather than stuck.
    const limit = node.getBoundingClientRect().height * 0.4
    const offset = raw <= limit ? raw : limit + (raw - limit) * 0.35
    drag.offset = offset
    node.style.transition = 'none'
    node.style.transform = `translate3d(0, ${offset}px, 0)`
  }

  function onPointerUp() {
    const drag = dragState.current
    if (!drag.active) return
    drag.active = false
    const elapsed = Math.max(1, performance.now() - drag.startTime)
    finishDrag(drag.offset / elapsed)
  }

  if (!open && !retained) return null

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={title ? titleId : undefined}
      className="app-dialog fixed inset-x-0 z-50 m-0 w-full max-h-none max-w-none bg-transparent p-0"
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
      onClick={event => {
        // Only a press on the dialog itself (the area around the sheet) closes.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={sheet}
        data-state={open ? 'open' : 'closed'}
        className={cn(
          'app-sheet absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-[560px] flex-col',
          'glass-sheet rounded-t-[25px] border-t border-x shadow-[0_-1px_0_var(--glass-highlight),var(--glass-shadow)]',
          'pb-(--app-safe-bottom)',
          size === 'tall' && 'app-sheet-tall',
          className,
        )}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center pt-2 pb-1 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="h-[5px] w-9 rounded-full bg-(--separator-strong)" />
        </div>

        {title ? (
          <header className="flex shrink-0 items-center gap-2 px-4 pb-2">
            <h2 id={titleId} className="flex-1 text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
            <IconButton icon="close" label="关闭" variant="quiet" onClick={onClose} />
          </header>
        ) : null}

        <div className="scroll-pane min-h-0 flex-1 overscroll-contain px-4 pb-4">{children}</div>
      </div>
    </dialog>,
    document.body,
  )
}
