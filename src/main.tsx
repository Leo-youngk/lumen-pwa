import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { LumenProvider } from './state/LumenContext'
import './styles/app.css'

/**
 * Lock the viewport.
 *
 * `user-scalable=no` in the viewport meta has been ignored by iOS since 10, so
 * the only reliable way is to intercept the gestures themselves:
 *
 * - `gesturestart` / `gesturechange` cover the pinch.
 * - A second `touchend` within 300 ms covers double-tap. Only the *second* tap
 *   is cancelled, so a normal single tap still fires its click.
 */
function lockZoom() {
  const prevent = (event: Event) => event.preventDefault()
  document.addEventListener('gesturestart', prevent, { passive: false })
  document.addEventListener('gesturechange', prevent, { passive: false })

  let lastEnd = 0
  document.addEventListener(
    'touchend',
    (event) => {
      const now = Date.now()
      if (now - lastEnd <= 300 && event.cancelable) event.preventDefault()
      lastEnd = now
    },
    { passive: false },
  )
}

lockZoom()

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

createRoot(container).render(
  <StrictMode>
    <LumenProvider>
      <App />
    </LumenProvider>
  </StrictMode>,
)
