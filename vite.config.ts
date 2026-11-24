import { fileURLToPath, URL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const version = execFileSync('git', ['describe', '--always', '--dirty'], { encoding: 'utf8' }).trim()

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'version-service-worker',
      apply: 'build',
      async writeBundle(output) {
        const directory = output.dir ?? 'dist'
        const html = await readFile(join(directory, 'index.html'), 'utf8')
        const revision = createHash('sha256').update(html).digest('hex').slice(0, 12)
        const workerPath = join(directory, 'sw.js')
        const source = await readFile(workerPath, 'utf8')
        await writeFile(workerPath, source.replace(
          /const VERSION = '[^']+'/,
          `const VERSION = 'lumen-shell-${revision}'`,
        ))
      },
    },
  ],
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
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
