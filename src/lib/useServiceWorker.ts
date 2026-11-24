import { useEffect, useRef } from 'react'

/**
 * Register the service worker in production builds only. In development a
 * cached shell hides HMR updates, so registration is skipped there.
 */
export function useServiceWorker(busy: boolean, beforeReload: () => Promise<void>): void {
  const busyRef = useRef(busy)
  busyRef.current = busy
  const beforeReloadRef = useRef(beforeReload)
  beforeReloadRef.current = beforeReload

  useEffect(() => {
    if (!import.meta.env.PROD) return
    if (!('serviceWorker' in navigator)) return

    let registration: ServiceWorkerRegistration | undefined
    let disposed = false
    let controlled = Boolean(navigator.serviceWorker.controller)
    let pending = false
    let refreshing = false
    const canRefresh = () => {
      if (disposed || !pending || busyRef.current || document.visibilityState !== 'hidden') return false
      const focused = document.activeElement
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return false
      if (document.querySelector('dialog[open], [contenteditable="true"], [aria-label="已引用的回答片段"]')) return false
      return !Array.from(document.querySelectorAll('textarea')).some(field => field.value.length > 0)
    }
    const refreshWhenSafe = async () => {
      if (refreshing || !canRefresh()) return
      refreshing = true
      try {
        await beforeReloadRef.current()
        if (canRefresh()) window.location.reload()
      } catch {
        // Keep the current page if saving before an update fails.
      } finally {
        refreshing = false
      }
    }
    const checkForUpdate = () => {
      if (document.visibilityState !== 'visible') return
      void registration?.update().catch(() => {})
    }
    const onVisibilityChange = () => {
      checkForUpdate()
      void refreshWhenSafe()
    }
    const onControllerChange = () => {
      // The first install takes control of an already current page.
      pending = controlled
      controlled = true
      void refreshWhenSafe()
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const interval = window.setInterval(checkForUpdate, 30 * 60_000)
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(result => {
        if (!disposed) registration = result
      })
      .catch(() => {
        // Registration and update failures must leave the current session usable.
      })

    return () => {
      disposed = true
      window.clearInterval(interval)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
}
