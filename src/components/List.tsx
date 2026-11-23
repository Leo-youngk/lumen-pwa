import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Icon, Tile, type IconName } from './Icon'

export interface RowProps {
  icon?: IconName
  tone?: 'brand' | 'blue' | 'teal' | 'orange'
  label: ReactNode
  detail?: ReactNode
  value?: ReactNode
  selected?: boolean
  onClick?: () => void
  /** A trailing chevron; on by default for tappable rows. */
  chevron?: boolean
  className?: string
}

/**
 * One row of an iOS grouped table.
 *
 * The row itself carries no card styling — grouping and separators belong to
 * `<List>`, which is what lets a list read as a single continuous surface
 * rather than a stack of unrelated cards.
 */
export function Row({
  icon,
  tone,
  label,
  detail,
  value,
  selected,
  onClick,
  chevron,
  className,
}: RowProps) {
  const Tag = onClick ? 'button' : 'div'
  const showChevron = chevron ?? Boolean(onClick)
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-3 px-4 text-left',
        // 44pt minimum, growing for two-line rows.
        'min-h-[48px] py-2.5',
        onClick && 'transition-colors duration-100 active:bg-(--separator)',
        className,
      )}
    >
      {icon ? <Tile icon={icon} tone={tone} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] leading-tight text-ink">{label}</span>
        {detail ? (
          <span className="mt-0.5 block truncate text-[13px] leading-tight text-quiet">
            {detail}
          </span>
        ) : null}
      </span>
      {value ? <span className="shrink-0 text-[15px] text-quiet">{value}</span> : null}
      {selected ? (
        <Icon name="check" size={17} className="shrink-0 text-brand" strokeWidth={2.2} />
      ) : showChevron ? (
        <Icon name="right" size={15} className="shrink-0 text-(--separator-strong)" strokeWidth={2} />
      ) : null}
    </Tag>
  )
}

export interface ListProps {
  children: ReactNode
  /** Section header, rendered uppercase above the group. */
  header?: string
  footer?: string
  className?: string
}

/**
 * Grouped container: rounded surface, hairline separators between children,
 * and an optional inset header/footer. Matches the inset-grouped table style.
 */
export function List({ children, header, footer, className }: ListProps) {
  return (
    <section className={cn('mb-6', className)}>
      {header ? <h2 className="section-label mb-2 px-4">{header}</h2> : null}
      <div
        className={cn(
          'overflow-hidden rounded-[15px] bg-surface',
          'hairline-t hairline-b',
          // Separators are drawn with a background gradient so they start at
          // the label instead of running edge to edge.
          '[&>*+*]:relative',
          "[&>*+*]:before:absolute [&>*+*]:before:inset-x-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-(--separator)",
          '[&>*+*]:before:ml-4',
          className,
        )}
      >
        {children}
      </div>
      {footer ? <p className="mt-2 px-4 text-[13px] leading-snug text-quiet">{footer}</p> : null}
    </section>
  )
}
