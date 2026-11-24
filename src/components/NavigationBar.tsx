import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from './Icon'

export interface NavigationBarProps {
  title?: string
  onBack?: () => void
  leading?: ReactNode
  center?: ReactNode
  trailing?: ReactNode
}

export function NavigationBar({ title, onBack, leading, center, trailing }: NavigationBarProps) {
  return (
    <header className="grid shrink-0 grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 px-3 py-1">
      <div className="flex items-center">
        {leading ?? (onBack ? <NavIconButton icon="left" label="返回" onClick={onBack} /> : null)}
      </div>

      <div className="flex min-w-0 justify-center">
        {center ?? (title ? <h1 className="truncate text-[16px] font-semibold">{title}</h1> : null)}
      </div>

      <div className="flex items-center justify-end">{trailing}</div>
    </header>
  )
}

export function NavIconButton({
  icon,
  label,
  onClick,
}: {
  icon: IconName
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-11 place-items-center rounded-full border border-edge text-ink',
        'transition-[transform,background-color] duration-150 ease-(--ease-tap) active:scale-95 active:bg-field',
      )}
    >
      <Icon name={icon} size={19} strokeWidth={1.9} />
    </button>
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
