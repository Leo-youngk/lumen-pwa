import { useEffect, useLayoutEffect, useState } from 'react'

/**
 * Only override the normal CSS viewport while an on-screen keyboard is open.
 * In that state Safari can pan as well as shrink the visible area.
 */
export function useViewport(): void {
  useLayoutEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    if (!viewport) return

    let frame = 0
    let keyboard = false
    let height = 0
    let top = 0
    const measure = () => {
      if (Math.abs(viewport.scale - 1) > 0.01) return
      const focused = document.activeElement
      const editing = focused instanceof HTMLTextAreaElement ||
        focused instanceof HTMLInputElement ||
        (focused instanceof HTMLElement && focused.isContentEditable)
      const visibleHeight = Math.round(viewport.height)
      const nextKeyboard = (editing || keyboard) && visibleHeight > 0 && window.innerHeight - visibleHeight > 80
      if (nextKeyboard !== keyboard) {
        keyboard = nextKeyboard
        root.toggleAttribute('data-keyboard', keyboard)
      }
      const nextHeight = keyboard ? visibleHeight : 0
      const nextTop = keyboard ? Math.max(0, Math.round(viewport.offsetTop)) : 0
      if (nextHeight !== height) {
        height = nextHeight
        if (height) root.style.setProperty('--app-height', `${height}px`)
        else root.style.removeProperty('--app-height')
      }
      if (nextTop !== top) {
        top = nextTop
        if (top) root.style.setProperty('--app-top', `${top}px`)
        else root.style.removeProperty('--app-top')
      }
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }

    measure()
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('pageshow', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('pageshow', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      root.style.removeProperty('--app-height')
      root.style.removeProperty('--app-top')
      root.removeAttribute('data-keyboard')
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
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    const surface = getComputedStyle(root).getPropertyValue('--color-content').trim()
    if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface)
  }, [theme])
}

/** Resolve a CSS custom property to a concrete colour. */
export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
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
