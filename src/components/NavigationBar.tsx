import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Icon, IconButton, type IconName } from './Icon'

/**
 * iOS navigation bar.
 *
 * Three things separate this from a generic web header:
 *
 * 1. It is a translucent material, not a solid bar, so content scrolling under
 *    it stays faintly visible — the strongest single cue that a page is native.
 * 2. The title is 17 pt semibold and stays centred even when the leading and
 *    trailing slot differ in width, which needs a symmetric grid rather than
 *    flexbox.
 * 3. It sits *below* the status bar; `--safe-top` supplies that inset, so the
 *    bar never collides with the notch or the clock.
 */
export interface NavigationBarProps {
  title?: string
  onBack?: () => void
  leading?: ReactNode
  trailing?: ReactNode
  divider?: boolean
  /** Hides the centred title until the scroll container passes the large title. */
  collapsed?: boolean
  className?: string
}

export function NavigationBar({
  title,
  onBack,
  leading,
  trailing,
  divider = true,
  collapsed = true,
  className,
}: NavigationBarProps) {
  return (
    <header
      className={cn(
        // Absolute rather than in-flow: the bar has to sit *on top of* the
        // scroll pane, otherwise the pane starts below it and there is nothing
        // behind the bar to blur. A sticky bar in a flex column looks identical
        // but silently disables the glass material.
        'glass-bar absolute inset-x-0 top-0 z-20',
        // Round the top corners to match the panel it sits inside, so the
        // material does not square off the frame.
        'rounded-t-[27px]',
        divider && 'border-b border-(--glass-border)',
        className,
      )}
    >
      <div className="grid h-(--nav-height) grid-cols-[1fr_auto_1fr] items-center px-2">
        <div className="flex items-center justify-start gap-0.5">
          {onBack ? <IconButton icon="left" label="返回" onClick={onBack} /> : leading}
        </div>
        {/* The inline title fades in as the large title scrolls out, which is
            the transition iOS uses to keep a title on screen at all times. */}
        <h1
          className={cn(
            'max-w-[52vw] truncate text-center text-[17px] font-semibold tracking-[-0.01em]',
            'transition-opacity duration-200 ease-(--ease-enter)',
            collapsed ? 'opacity-100' : 'opacity-0',
          )}
        >
          {title}
        </h1>
        <div className="flex items-center justify-end gap-0.5">{trailing}</div>
      </div>
    </header>
  )
}

/**
 * Height of the bar including the status-bar inset. Scroll content adds this as
 * top padding so the first row clears the bar while later rows still slide
 * underneath it.
 */
export function useNavOffset(): string {
  return 'var(--nav-height)'
}

/**
 * Large title that collapses into the navigation bar on scroll.
 *
 * `scrollRef` must point at the element that actually scrolls the page; the
 * hook watches it with a passive listener rather than an IntersectionObserver
 * because the threshold has to line up with the 44 pt bar height, not with a
 * fraction of the title's own height.
 */
export function CollapsingLargeTitle({
  title,
  scrollRef,
  onChange,
}: {
  title: ReactNode
  scrollRef: React.RefObject<HTMLElement | null>
  onChange: (collapsed: boolean) => void
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  const collapsed = useRef(false)

  useEffect(() => {
    const scroller = scrollRef.current
    const node = sentinel.current
    if (!scroller || !node) return

    const check = () => {
      const next = node.getBoundingClientRect().bottom <= 56
      if (next !== collapsed.current) {
        collapsed.current = next
        onChange(next)
      }
    }

    check()
    scroller.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => {
      scroller.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [onChange, scrollRef])

  return (
    <div ref={sentinel}>
      <h1 className="px-4 pt-1 pb-4 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">
        {title}
      </h1>
    </div>
  )
}

/** Plain text action — the "取消 / 完成" half of the iOS bar idiom. */
export function BarButton({
  children,
  onClick,
  bold,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  bold?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-11 px-2 text-[17px] text-brand',
        'transition-opacity duration-150 active:opacity-50 disabled:opacity-35',
        bold && 'font-semibold',
      )}
    >
      {children}
    </button>
  )
}

/** Inline action with an optional glyph, e.g. "刷新". */
export function LabelButton({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon?: IconName
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center gap-1 rounded-full px-2.5',
        'text-[15px] font-medium text-brand',
        'transition-[opacity,transform] duration-150 ease-(--ease-tap) active:scale-95',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      {icon ? <Icon name={icon} size={15} strokeWidth={2} /> : null}
      {children}
    </button>
  )
}
