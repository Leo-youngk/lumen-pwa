import { useEffect } from 'react'

/**
 * Register the service worker in production builds only. In development a
 * cached shell hides HMR updates, so registration is skipped there.
 */
export function useServiceWorker(): void {
  useEffect(() => {
    if (!import.meta.env.PROD) return
    if (!('serviceWorker' in navigator)) return
    const timer = window.setTimeout(() => {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // A failed registration only costs offline support; the app still runs.
      })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [])
}
