import { unzipSync } from 'fflate'
import { parse as parseHtml } from 'parse5'
import { SaxesParser } from 'saxes'

const maxFileBytes = 16 * 1024 * 1024
const maxXmlAndHtmlBytes = 14 * 1024 * 1024
const maxMarkdownBytes = 4 * 1024 * 1024
const encoder = new TextEncoder()

function xml(source, visit, close) {
  const parser = new SaxesParser({ xmlns: true })
  const values = []
  parser.on('opentag', node => {
    visit(node.local, Object.fromEntries(
      Object.values(node.attributes).map(({ local, value }) => [local, value])
    ))
    if (close) values.push('')
  })
  if (close) {
    parser.on('text', text => { if (values.length) values[values.length - 1] += text })
    parser.on('cdata', text => { if (values.length) values[values.length - 1] += text })
    parser.on('closetag', node => {
      const value = values.pop()
      if (values.length) values[values.length - 1] += value
      close(node.local, value.trim())
    })
  }
  parser.write(source).close()
}

function zipPath(parent, path) {
  if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return ''
  const relative = decodeURIComponent(path.split(/[?#]/, 1)[0])
  const parts = relative.startsWith('/') ? [] : parent.split('/').slice(0, -1)
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (!parts.length) throw new Error('EPUB 的章节路径无效。')
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

const skip = new Set(['script', 'style', 'nav', 'template', 'svg', 'noscript'])
const escapeMarkdown = text => text.replace(/[\\`*_\[\]<>]/g, '\\$&')
const childText = node => node.nodeName === '#text'
  ? node.value
  : (node.childNodes ?? []).map(childText).join('')
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value

function chapterMarkdown(html) {
  const body = parseHtml(html).childNodes.find(node => node.tagName === 'html')
    ?.childNodes.find(node => node.tagName === 'body')
  let heading = ''
  function render(node, depth = 0, listType = '') {
    if (depth > 120) throw new Error('EPUB 章节的 HTML 嵌套过深。')
    const tag = node.tagName
    if (skip.has(tag) || attr(node, 'hidden') !== undefined || attr(node, 'aria-hidden') === 'true') return ''
    if (node.nodeName === '#text') return escapeMarkdown(node.value.replace(/\s+/g, ' '))
    if (tag === 'br') return '\n'
    if (tag === 'hr') return '\n\n---\n\n'
    if (tag === 'img') return attr(node, 'alt') ? `[图片：${escapeMarkdown(attr(node, 'alt'))}]` : ''
    if (tag === 'pre') {
      const text = childText(node).trimEnd()
      const fence = '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)))
      return `\n\n${fence}\n${text}\n${fence}\n\n`
    }
    const children = node.childNodes ?? []
    if (tag === 'ul' || tag === 'ol') return `\n\n${children.map(child => render(child, depth + 1, tag)).join('').trim()}\n\n`
    const raw = children.map(child => render(child, depth + 1)).join('')
    const text = raw.trim()
    if (!text) return raw
    if (/^h[1-6]$/.test(tag)) {
      heading ||= childText(node).replace(/\s+/g, ' ').trim()
      return `\n\n${'#'.repeat(Number(tag[1]))} ${text}\n\n`
    }
    if (tag === 'strong' || tag === 'b') return raw.replace(text, () => `**${text}**`)
    if (tag === 'em' || tag === 'i') return raw.replace(text, () => `*${text}*`)
    if (tag === 'blockquote') return `\n\n${text.split('\n').map(line => `> ${line}`).join('\n')}\n\n`
    if (tag === 'li') return `${listType === 'ol' ? '1.' : '-'} ${text.replace(/\n(?=\S)/g, '\n  ')}\n`
    if (tag === 'td' || tag === 'th') return `${text} | `
    if (tag === 'tr') return `${text}\n`
    if (/^(p|div|section|article|header|footer|aside|figure|figcaption|table|dd|dt)$/.test(tag)) return `\n\n${text}\n\n`
    return raw
  }
  const text = body ? render(body).replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim() : ''
  return { heading, text }
}

export async function convertEpub(request) {
  if (!request.body) throw new Error('没有收到 EPUB 文件。')
  const reader = request.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxFileBytes) {
        void reader.cancel().catch(() => {})
        return { status: 413, error: 'EPUB 最大支持 16 MB。' }
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let expanded = 0
  const names = new Set()
  const files = unzipSync(bytes, { filter: ({ name, originalSize }) => {
    if (!/\.(xml|opf|x?html|htm|ncx)$/i.test(name)) return false
    if (names.has(name)) throw new Error('EPUB 有重复的文件路径。')
    names.add(name)
    expanded += originalSize
    if (expanded > maxXmlAndHtmlBytes || names.size > 3000) throw new Error('EPUB 解压后的正文超出转换上限。')
    return true
  } })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const read = path => {
    if (!Object.hasOwn(files, path)) throw new Error(`EPUB 缺少文件：${path}`)
    const data = files[path]
    if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(data)
    if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(data)
    return decoder.decode(data)
  }
  let packagePath = ''
  xml(read('META-INF/container.xml'), (tag, a) => {
    if (tag === 'rootfile' && !packagePath) packagePath = a['full-path']
  })
  if (!packagePath) throw new Error('EPUB 缺少书籍清单。')
  if (Object.hasOwn(files, 'META-INF/encryption.xml')) {
    const names = []
    xml(read('META-INF/encryption.xml'), (tag, a) => {
      if (tag === 'CipherReference') names.push(zipPath('', a.URI))
    })
    if (names.some(name => !/\.(otf|ttf|woff2?)$/i.test(name))) throw new Error('这本 EPUB 的内容受加密保护，无法转换。')
  }
  const manifest = new Map()
  const spine = []
  let title = ''
  let author = ''
  xml(read(packagePath), (tag, a) => {
    if (tag === 'item') manifest.set(a.id, a)
    if (tag === 'itemref') spine.push(a)
  }, (tag, value) => {
    if (tag === 'title' && !title) title = value
    if (tag === 'creator' && !author) author = value
  })
  const chapters = []
  let charCount = 0
  let markdownBytes = 0
  let unreadable = 0
  for (const item of spine) {
    let entry = manifest.get(item.idref)
    if (!entry) throw new Error('EPUB 的阅读顺序引用了缺失的章节。')
    const seen = new Set()
    while (entry?.fallback && !/html/i.test(entry['media-type']) && !seen.has(entry.id)) {
      seen.add(entry.id)
      entry = manifest.get(entry.fallback)
    }
    if (!entry || !/html/i.test(entry['media-type'])) {
      if (item.linear !== 'no') unreadable += 1
      continue
    }
    const path = zipPath(packagePath, entry.href)
    if (!path) throw new Error('EPUB 包含无法本地读取的章节。')
    const { heading, text } = chapterMarkdown(read(path))
    if (!text) {
      if (item.linear !== 'no' && !entry.properties?.split(/\s+/).includes('nav')) unreadable += 1
      continue
    }
    charCount += text.length
    markdownBytes += encoder.encode(text).byteLength
    if (markdownBytes > maxMarkdownBytes) return { status: 413, error: '转换后的 Markdown 超过 4 MB。' }
    chapters.push({ title: heading || `第 ${chapters.length + 1} 节`, text })
  }
  if (!chapters.length) throw new Error('没有读到文字正文。这本书可能是图片版。')
  return { title, author, charCount, unreadable, chapterCount: chapters.length, chapters }
}

export async function handleEpub(request) {
  try {
    const result = await convertEpub(request)
    return Response.json(result.error ? { error: result.error } : result, {
      status: result.status || 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const message = error instanceof Error && /[\u3400-\u9fff]/.test(error.message)
      ? error.message : '无法读取 EPUB，请确认它是完整且未加密的电子书。'
    return Response.json({ error: message }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }
}
