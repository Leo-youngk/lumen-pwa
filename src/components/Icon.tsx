import { type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * SF-Symbols-style glyphs.
 *
 * Inline SVG instead of an icon package: the whole set is under 3 KB, strokes
 * match the 1.7 pt weight iOS uses for toolbars, and there is no runtime
 * dependency to keep current. Paths are drawn on a 24×24 grid.
 */
const PATHS = {
  history:
    'M12 8v5l3 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 4.5V9h4.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  compose: 'M4 20h4L20 8a2.6 2.6 0 0 0-4-4L4 16v4ZM15 5l4 4',
  speaker: 'M11 5 6.5 9H4v6h2.5L11 19V5ZM15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  down: 'M5 9l7 7 7-7',
  up: 'M5 15l7-7 7 7',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  send: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
  stop: 'M8 8h8v8H8z',
  book: 'M4 5.5A2 2 0 0 1 6 3.5h5v17H6a2 2 0 0 0-2 2zM20 5.5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2z',
  idea: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.3.2.5.6.5 1v.1h6v-.1c0-.4.2-.8.5-1A6 6 0 0 0 12 3Z',
  chip: 'M8.5 4.5h7v15h-7zM4.5 8.5v7M19.5 8.5v7M11 9.5h2M11 12h2M11 14.5h2',
  chat: 'M4 6a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 6v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4z',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14',
  refresh:
    'M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20',
  check: 'M5 12.5 10 17.5 19 7.5',
  copy: 'M9 8h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2ZM17 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2',
  quote: 'M9.5 11H4V8.5A4.5 4.5 0 0 1 8 4M4 11v6h6v-6ZM19.5 11H14V8.5A4.5 4.5 0 0 1 18 4M14 11v6h6v-6Z',
  pin: 'M14 3l7 7-2 2-3-1-4 4v3l-2 2-6-6 2-2h3l4-4-1-3 2-2ZM7 17l-4 4',
  usage: 'M4 19V9M9.5 19V5M15 19v-7M20.5 19v-4',
  provider: 'M12 3v18M7 7.5h10M6 16.5h12',
  sliders: 'M4 8h9M17 8h3M4 16h3M11 16h9M13 5v6M7 13v6',
  logo: 'M12 3.5c3.6 0 6.5 2.7 6.5 6 0 2.4-1.5 4.4-3.6 5.4-.6.3-1 .9-1 1.6v.5h-3.8v-.5c0-.7-.4-1.3-1-1.6A6 6 0 0 1 5.5 9.5c0-3.3 2.9-6 6.5-6Z M9 20h6',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 13h9.4l.8-13',
} as const

export type IconName = keyof typeof PATHS

export interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}

export function Icon({ name, size = 21, strokeWidth = 1.7, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export interface IconButtonProps {
  icon: IconName
  label: string
  onClick?: () => void
  variant?: 'plain' | 'glass' | 'quiet'
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}

/**
 * 44×44 tap target, which is the iOS minimum. The visual circle is smaller
 * than the hit area on purpose: an icon button that *looks* 44pt wide reads as
 * heavy next to a nav title.
 */
export function IconButton({
  icon,
  label,
  onClick,
  variant = 'plain',
  disabled,
  className,
  type = 'button',
}: IconButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'relative grid size-11 shrink-0 place-items-center rounded-full text-ink',
        'transition-[transform,background-color,opacity] duration-150 ease-(--ease-tap)',
        'active:scale-[0.92] disabled:pointer-events-none disabled:opacity-35',
        variant === 'glass' && 'glass-chrome',
        variant === 'quiet' && 'text-quiet',
        'hover:bg-(--separator)',
        className,
      )}
    >
      <Icon name={icon} strokeWidth={1.9} />
    </button>
  )
}

/** Leading icon in a rounded tinted square, as used down iOS grouped lists. */
export function Tile({
  icon,
  tone = 'brand',
  children,
}: {
  icon?: IconName
  tone?: 'brand' | 'blue' | 'teal' | 'orange'
  children?: ReactNode
}) {
  const tones = {
    brand: 'bg-brand-soft text-brand-ink',
    blue: 'bg-accent-blue text-accent-blue-ink',
    teal: 'bg-accent-teal text-accent-teal-ink',
    orange: 'bg-accent-orange text-accent-orange-ink',
  } as const
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-[29px] shrink-0 place-items-center overflow-hidden rounded-[7px]',
        tones[tone],
      )}
    >
      {children ?? (icon ? <Icon name={icon} size={18} strokeWidth={1.8} /> : null)}
    </span>
  )
}
