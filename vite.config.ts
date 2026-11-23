import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Mirrors the `@/*` path mapping in tsconfig.json; Vite does not read
    // `compilerOptions.paths` on its own.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep the vendor code in its own chunk so the app shell stays small
        // on a cold PWA start.
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    // A deliberate non-default port so this never collides with another dev
    // server on the machine.
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
