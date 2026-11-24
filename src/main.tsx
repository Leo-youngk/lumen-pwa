import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { LumenProvider } from './state/LumenContext'
import './styles/app.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')
document.documentElement.dataset.version = import.meta.env.VITE_APP_VERSION

createRoot(container).render(
  <StrictMode>
    <LumenProvider>
      <App />
    </LumenProvider>
  </StrictMode>,
)
