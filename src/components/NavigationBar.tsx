import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from './Icon'

/**
 * Floating navigation controls.
 *
 * iOS puts the bar's controls *on* the content as separate circular glass
 * chips rather than a full-width strip: the page keeps its top edge, and the
 * buttons read as objects lying on top of it. A full-width bar forces an opaque
 * band and a seam wherever the content behind differs in brightness.
 *
 * The centre slot is intentionally empty by default. The reference app puts a
 * segmented control there, but a two-tab switch only makes sense when there are
 * two destinations; this app has one, so the slot stays free for a title.
 */
export interface NavigationBarProps {
  title?: string
  onBack?: () => void
  leading?: ReactNode
  trailing?: ReactNode
  /** Show the title as a centre chip. Off on screens that carry a large title. */
  showTitle?: boolean
  className?: string
}

export function NavigationBar({ title, onBack, leading, trailing, showTitle = false, className }: NavigationBarProps) {
  return (
    <header
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 px-3 pt-2',
        className,
      )}
    >
      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        {leading ?? (onBack ? <GlassButton icon="left" label="返回" onClick={onBack} /> : null)}
      </div>

      <div className="pointer-events-none flex min-w-0 flex-1 justify-center pt-1.5">
        {showTitle && title ? (
          <span className="pointer-events-auto max-w-full truncate rounded-full px-3 text-[15px] leading-8 font-semibold">
            {title}
          </span>
        ) : null}
      </div>

      <div className="pointer-events-auto flex shrink-0 items-center gap-2">{trailing}</div>
    </header>
  )
}

/** A circular glass chip. 44pt hit area, 40pt visual. */
export function GlassButton({
  icon,
  label,
  onClick,
  badge,
}: {
  icon: IconName
  label: string
  onClick?: () => void
  /** Small accent dot on the top-right, as on the reference's menu button. */
  badge?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'glass-chrome relative grid size-10 place-items-center rounded-full text-ink',
        'transition-[transform,background-color] duration-150 ease-(--ease-tap) active:scale-95',
      )}
    >
      <Icon name={icon} size={19} strokeWidth={1.9} />
      {badge ? (
        <span className="absolute top-[7px] right-[7px] size-[7px] rounded-full bg-(--color-action) ring-2 ring-(--color-surface)" />
      ) : null}
    </button>
  )
}

/**
 * Large title that collapses into the centre chip on scroll.
 *
 * `scrollRef` must point at the element that actually scrolls the page; the
 * hook watches it with a passive listener rather than an IntersectionObserver
 * because the threshold has to line up with the bar height, not with a
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
      <h1 className="px-1 pt-1 pb-4 text-[32px] leading-[1.1] font-bold tracking-[-0.02em]">{title}</h1>
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
        'h-10 rounded-full px-3 text-[16px] text-(--color-action)',
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
        'text-[15px] font-medium text-(--color-action)',
        'transition-[opacity,transform] duration-150 ease-(--ease-tap) active:scale-95',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      {icon ? <Icon name={icon} size={15} strokeWidth={2} /> : null}
      {children}
    </button>
  )
}
