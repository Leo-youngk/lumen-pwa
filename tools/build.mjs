/**
 * Assemble the Worker output directory.
 *
 * The API half of this project is the Worker in `worker/`, which was recovered
 * from the original deployment and is kept as-is. This script builds the
 * frontend with Vite and then lays both halves out the way `wrangler.jsonc`
 * expects:
 *
 *   built/worker.mjs   ← bundled Worker entry
 *   built/public/      ← static assets served by the ASSETS binding
 *
 * Run: node tools/build.mjs
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, rm, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const built = join(root, 'built')

async function main() {
  console.log('→ building frontend')
  execFileSync('npx', ['vite', 'build'], { stdio: 'inherit', cwd: root })

  console.log('→ resetting built/')
  await rm(built, { recursive: true, force: true })
  await mkdir(built, { recursive: true })

  console.log('→ copying static assets')
  await cp(join(root, 'dist'), join(built, 'public'), { recursive: true })

  console.log('→ bundling worker')
  if (!existsSync(join(root, 'node_modules/.bin/esbuild'))) {
    throw new Error('esbuild is missing; run `npm install` in the repo that holds worker/.')
  }
  execFileSync(
    join(root, 'node_modules/.bin/esbuild'),
    [
      'worker/index.mjs',
      '--bundle',
      '--format=esm',
      '--platform=browser',
      '--minify',
      `--outfile=${join(built, 'worker.mjs')}`,
    ],
    { stdio: 'inherit', cwd: root },
  )

  console.log('✓ built/worker.mjs and built/public/ are ready for wrangler')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
