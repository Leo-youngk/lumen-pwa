import { useEffect, useRef, useState } from 'react'

/**
 * Track the visual viewport so the composer can sit above the on-screen
 * keyboard.
 *
 * `100dvh` alone is not enough on iOS: when the keyboard opens, the layout
 * viewport does not resize, so a bottom-docked composer ends up hidden behind
 * it. The visual viewport does report the keyboard, so we publish its height
 * and its offset from the layout viewport as CSS variables and let the layout
 * react. `--kb-offset` is 0 when no keyboard is present.
 */
export function useViewport(): void {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    if (!viewport) {
      root.style.setProperty('--app-height', '100dvh')
      return
    }

    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const height = viewport.height
        // The keyboard height is the gap between the layout viewport and the
        // visual viewport, minus the offset the page has already scrolled by.
        const offset = Math.max(0, window.innerHeight - height - viewport.offsetTop)
        root.style.setProperty('--app-height', `${Math.round(height)}px`)
        root.style.setProperty('--kb-offset', `${Math.round(offset)}px`)
        root.toggleAttribute('data-keyboard', offset > 80)
      })
    }

    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
    }
  }, [])
}

/**
 * Write the active theme onto `<html>` and keep the browser chrome in sync.
 *
 * The `theme-color` meta tag is what tints Safari's toolbar and the iOS status
 * bar area; leaving it stale is the difference between an app that looks
 * installed and one that looks like a website.
 */
export function useTheme(theme: 'light' | 'dark' | 'mono' | 'cream'): void {
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    const canvas = getComputedStyle(root).getPropertyValue('--color-canvas').trim()
    if (!canvas) return
    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach(meta => meta.setAttribute('content', canvas))
  }, [theme])
}

/** Resolve a CSS custom property to a concrete colour. */
export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * Lock background scrolling while a sheet is open, without the iOS jump that
 * `overflow: hidden` causes when the page is already scrolled.
 */
export function useScrollLock(active: boolean): void {
  const restore = useRef<{ y: number } | null>(null)

  useEffect(() => {
    if (!active) return
    const y = window.scrollY
    restore.current = { y }
    document.body.style.position = 'fixed'
    document.body.style.top = `-${y}px`
    document.body.style.width = '100%'
    return () => {
      const saved = restore.current
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      if (saved) window.scrollTo(0, saved.y)
      restore.current = null
    }
  }, [active])
}

/** True when the device reports a coarse pointer (touch-first). */
export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  )
  useEffect(() => {
    const query = matchMedia('(pointer: coarse)')
    const update = () => setTouch(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return touch
}
