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
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split the heavy, conditionally-used libraries out of the shell so a
        // cold start downloads only what the first screen needs.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('/react/')) return 'react'
            // The Markdown pipeline (remark/rehype/unified/mdast/hast) is only
            // needed once a message exists; it is imported lazily anyway, and
            // naming it keeps it out of the entry chunk.
            if (/node_modules\/(react-markdown|remark-|rehype-|unified|micromark|mdast-|hast-|unist-|vfile|bail|trough|is-plain-obj|devlop|html-url-attributes|commonmark|character-entities|decode-named-character-reference|trim-lines|space-separated-tokens|comma-separated-tokens|property-information|style-to-object|inline-style-parser|longest-streak|zwitch|ccount|markdown-table|escape-string-regexp|extend|estree|@types)/.test(id)) {
              return 'markdown'
            }
            if (id.includes('katex')) return 'katex'
            // Shiki grammars are deliberately NOT grouped: each language is its
            // own dynamic import, and merging them would make a Python snippet
            // download every other grammar too.
            if (id.includes('/shiki/dist/') && !id.includes('/langs/') && !id.includes('/themes/')) {
              return 'shiki-core'
            }
          }
          return undefined
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
