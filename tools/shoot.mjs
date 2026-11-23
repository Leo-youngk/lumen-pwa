/**
 * Screenshot harness.
 *
 * Drives the local Chrome over the DevTools protocol with no extra
 * dependencies: it launches the installed binary headless, then talks to it
 * with a small CDP client built on Node's built-in WebSocket.
 *
 * Usage: node tools/shoot.mjs [outDir]
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = process.argv[2] || '/tmp/shots'
const CHROME = process.env.CHROME || '/usr/local/bin/google-chrome'
const PORT = 9222
const BASE = 'http://localhost:4173'
const TOKEN = 'local-test-only'

// iPhone 16 Pro logical viewport.
const VIEWPORT = { width: 393, height: 852, scale: 3 }

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function cdpTargets() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await response.json()
      const page = list.find(item => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Chrome is still booting.
    }
    await sleep(250)
  }
  throw new Error('Chrome did not expose a page target')
}

function connect(url) {
  const ws = new WebSocket(url)
  let id = 0
  const pending = new Map()
  const events = []

  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    } else if (message.method) {
      events.push(message.method)
    }
  })

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', reject)
  })

  return {
    ready,
    events,
    send(method, params = {}) {
      id += 1
      const current = id
      ws.send(JSON.stringify({ id: current, method, params }))
      return new Promise((resolve, reject) => pending.set(current, { resolve, reject }))
    },
    close: () => ws.close(),
  }
}

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const profile = join(OUT, '.profile')
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--force-device-scale-factor=3',
      '--window-size=393,852',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const target = await cdpTargets()
  const cdp = connect(target)
  await cdp.ready

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: VIEWPORT.scale,
    mobile: true,
  })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  })

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'evaluate failed')
    }
    return result.result.value
  }

  async function shot(name) {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    await writeFile(join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
    console.log(`  ✓ ${name}.png`)
  }

  async function goto(url) {
    await cdp.send('Page.navigate', { url })
    // Wait for React to paint the first screen.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(120)
      const ready = await evaluate(`document.querySelector('#root')?.children.length > 0`)
      if (ready) break
    }
    await sleep(400)
  }

  console.log('→ home (signed out)')
  await goto(BASE)
  await shot('01-signin')

  console.log('→ sign in')
  await evaluate(`
    (() => {
      const input = document.querySelector('input[type="password"]')
      if (!input) return 'no input'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '${TOKEN}')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return 'filled'
    })()
  `)
  await sleep(250)
  await evaluate(`document.querySelector('form button[type="submit"]').click()`)
  await sleep(2200)

  const authed = await evaluate(`Boolean(document.querySelector('textarea[aria-label="输入消息"]'))`)
  if (!authed) {
    await shot('01b-login-failed')
    throw new Error('sign-in did not reach the home screen')
  }

  console.log('→ home')
  await shot('02-home')

  console.log('→ streaming reply')
  await evaluate(`
    (() => {
      const field = document.querySelector('textarea[aria-label="输入消息"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, '这本书的核心观点是什么？')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      return 'typed'
    })()
  `)
  await sleep(200)
  await evaluate(`
    (() => {
      const field = document.querySelector('textarea[aria-label="输入消息"]')
      field.focus()
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return 'submitted'
    })()
  `)
  await sleep(900)
  await shot('03-chat-streaming')

  await sleep(4200)
  await shot('04-chat-answer')

  console.log('→ model sheet')
  await evaluate(`
    (() => {
      const pill = [...document.querySelectorAll('button')]
        .find(button => button.getAttribute('aria-haspopup') === 'dialog')
      pill?.click()
      return Boolean(pill)
    })()
  `)
  await sleep(700)
  await shot('05-model-sheet')
  await evaluate(`
    (() => {
      const dialog = document.querySelector('dialog')
      if (!dialog) return 'no dialog'
      dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }))
      return 'cancelled'
    })()
  `)
  await sleep(400)

  console.log('→ history with scrolled glass bar')
  await evaluate(`
    (() => {
      const back = document.querySelector('button[aria-label="返回"]')
      back?.click()
      return Boolean(back)
    })()
  `)
  await sleep(600)
  await evaluate(`
    (() => {
      const history = document.querySelector('button[aria-label="打开历史"]')
      history?.click()
      return Boolean(history)
    })()
  `)
  await sleep(800)
  await shot('06-history')

  console.log('→ scrolled so rows pass under the bar')
  await evaluate(`
    (() => {
      const pane = [...document.querySelectorAll('.scroll-pane')]
        .filter(node => !node.closest('dialog') && node.scrollHeight > node.clientHeight)
        .pop()
      if (!pane) return 'no scrollable pane'
      pane.scrollTop = 140
      pane.dispatchEvent(new Event('scroll'))
      return pane.scrollTop
    })()
  `)
  await sleep(900)
  await shot('07-history-scrolled')

  console.log('→ settings')
  await evaluate(`
    (() => {
      const back = document.querySelector('button[aria-label="返回"]')
      back?.click()
      return Boolean(back)
    })()
  `)
  await sleep(600)
  await evaluate(`
    (() => {
      const settings = document.querySelector('button[aria-label="设置"]')
      settings?.click()
      return Boolean(settings)
    })()
  `)
  await sleep(800)
  await shot('08-settings')

  console.log('→ settings scrolled (collapsed title)')
  await evaluate(`
    (() => {
      const pane = [...document.querySelectorAll('.scroll-pane')]
        .filter(node => !node.closest('dialog') && node.scrollHeight > node.clientHeight)
        .pop()
      if (!pane) return 'no scrollable pane'
      pane.scrollTop = 300
      pane.dispatchEvent(new Event('scroll'))
      return pane.scrollTop
    })()
  `)
  await sleep(900)
  await shot('09-settings-scrolled')

  console.log('→ dark mode')
  await evaluate(`
    (() => {
      const root = document.documentElement
      root.dataset.theme = 'dark'
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', '#17201c')
      return 'dark'
    })()
  `)
  await sleep(500)
  await shot('10-settings-dark')

  await evaluate(`
    (() => {
      const pane = [...document.querySelectorAll('.scroll-pane')]
        .filter(node => !node.closest('dialog') && node.scrollHeight > node.clientHeight)
        .pop()
      if (pane) pane.scrollTop = 0
      pane.dispatchEvent(new Event('scroll'))
      return 'top'
    })()
  `)
  await sleep(500)
  await shot('11-settings-dark-top')

  const errors = cdp.events.filter(name => name === 'Runtime.exceptionThrown').length
  console.log(`\nJS exceptions observed: ${errors}`)

  cdp.close()
  chrome.kill()
  console.log(`\nScreenshots in ${OUT}`)
}

main().catch(async error => {
  console.error('failed:', error.message)
  spawn('pkill', ['-f', 'remote-debugging-port=9222'])
  process.exit(1)
})
