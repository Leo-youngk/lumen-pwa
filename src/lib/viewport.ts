import { useEffect, useLayoutEffect, useState } from 'react'

/**
 * Fit the whole app to the visible part of the screen. On iOS the keyboard
 * shrinks the visual viewport without necessarily resizing the layout viewport.
 */
export function useViewport(): void {
  useLayoutEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    if (!viewport) return

    let frame = 0
    const measure = () => {
      if (Math.abs(viewport.scale - 1) > 0.01) return
      const height = Math.round(viewport.height)
      const keyboard = window.innerHeight - height > 80
      const top = keyboard ? Math.max(0, Math.round(viewport.offsetTop)) : 0
      root.style.setProperty('--app-height', `${height}px`)
      root.style.setProperty('--app-top', `${top}px`)
      root.toggleAttribute('data-keyboard', keyboard)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }

    measure()
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
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
    if (!surface) return
    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach(meta => meta.setAttribute('content', surface))
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
