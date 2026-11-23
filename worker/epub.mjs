import { unzipSync } from 'fflate'
import { parse as parseHtml } from 'parse5'
import { SaxesParser } from 'saxes'

const maxFileBytes = 16 * 1024 * 1024
const maxXmlAndHtmlBytes = 14 * 1024 * 1024
const maxMarkdownBytes = 8 * 1024 * 1024
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

const skip = new Set(['script', 'style', 'template', 'noscript', 'defs', 'metadata'])
const escapeMarkdown = text => text.replace(/[\\`*_\[\]<>]/g, '\\$&')
const childText = node => node.nodeName === '#text'
  ? node.value
  : (node.childNodes ?? []).map(childText).join('')
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value
const hasWord = text => /[^\p{White_Space}\p{P}\p{S}]/u.test(text)
const hasProperty = (value, property) => value?.split(/\s+/).includes(property) ?? false
const readableType = type => /^(application\/xhtml\+xml|text\/html|image\/svg\+xml)$/i.test(type ?? '')

function chapterMarkdown(html) {
  const body = parseHtml(html).childNodes.find(node => node.tagName === 'html')
    ?.childNodes.find(node => node.tagName === 'body')
  let heading = ''
  let hasText = false
  let hasMedia = false
  let cover = false
  const codeBlocks = []
  function render(node, depth = 0, listType = '') {
    if (depth > 120) throw new Error('EPUB 章节的 HTML 嵌套过深。')
    const tag = node.tagName
    if (skip.has(tag) || attr(node, 'hidden') !== undefined) return ''
    cover ||= hasProperty(attr(node, 'epub:type'), 'cover') || attr(node, 'role') === 'doc-cover'
    if (node.nodeName === '#text') {
      hasText ||= hasWord(node.value)
      return escapeMarkdown(node.value.replace(/\s+/g, ' '))
    }
    if (tag === 'br') return '\n'
    if (tag === 'hr') return '\n\n---\n\n'
    if (tag === 'img' || tag === 'image') {
      hasMedia = true
      const alt = attr(node, 'alt') || attr(node, 'aria-label')
      return alt?.trim() ? `[图片：${escapeMarkdown(alt.trim())}]` : ''
    }
    hasMedia ||= tag === 'svg' || tag === 'object' || tag === 'video'
    if (tag === 'pre') {
      const text = childText(node).trimEnd()
      hasText ||= Boolean(text.trim())
      let width = 3
      for (const match of text.matchAll(/`+/g)) width = Math.max(width, match[0].length + 1)
      const fence = '`'.repeat(width)
      return `\n\n\0${codeBlocks.push(`${fence}\n${text}\n${fence}`) - 1}\0\n\n`
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
    if (tag === 'text' || tag === 'title' || tag === 'desc') return `\n\n${text}\n\n`
    if (/^(p|div|section|article|header|footer|aside|figure|figcaption|table|dd|dt)$/.test(tag)) return `\n\n${text}\n\n`
    return raw
  }
  const text = body ? render(body).replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim()
    .replace(/\0(\d+)\0/g, (_, index) => codeBlocks[Number(index)]) : ''
  return { heading, text, hasText, hasMedia, cover }
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
  const extract = allow => unzipSync(bytes, { filter: ({ name, originalSize }) => {
    if (!allow(name)) return false
    if (names.has(name)) throw new Error('EPUB 有重复的文件路径。')
    names.add(name)
    expanded += originalSize
    if (expanded > maxXmlAndHtmlBytes || names.size > 3000) throw new Error('EPUB 解压后的正文超出转换上限。')
    return true
  } })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const read = (files, path) => {
    if (!Object.hasOwn(files, path)) throw new Error(`EPUB 缺少文件：${path}`)
    const data = files[path]
    if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(data)
    if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(data)
    return decoder.decode(data)
  }
  const metadata = extract(name => name === 'META-INF/container.xml' || name === 'META-INF/encryption.xml')
  let packagePath = ''
  xml(read(metadata, 'META-INF/container.xml'), (tag, a) => {
    if (tag === 'rootfile' && !packagePath) packagePath = a['full-path']
  })
  if (!packagePath) throw new Error('EPUB 缺少书籍清单。')
  if (Object.hasOwn(metadata, 'META-INF/encryption.xml')) {
    const names = []
    xml(read(metadata, 'META-INF/encryption.xml'), (tag, a) => {
      if (tag === 'CipherReference') names.push(zipPath('', a.URI))
    })
    if (names.some(name => !/\.(otf|ttf|woff2?)$/i.test(name))) throw new Error('这本 EPUB 的内容受加密保护，无法转换。')
  }
  const manifest = new Map()
  const spine = []
  const coverPaths = new Set()
  let coverId = ''
  let title = ''
  let author = ''
  xml(read(extract(name => name === packagePath), packagePath), (tag, a) => {
    if (tag === 'item') manifest.set(a.id, a)
    if (tag === 'itemref') spine.push(a)
    if (tag === 'meta' && a.name === 'cover') coverId = a.content
    if (tag === 'reference' && hasProperty(a.type, 'cover')) coverPaths.add(zipPath(packagePath, a.href))
  }, (tag, value) => {
    if (tag === 'title' && !title) title = value
    if (tag === 'creator' && !author) author = value
  })
  const sections = spine.map(item => {
    let entry = manifest.get(item.idref)
    const seen = new Set()
    while (entry?.fallback && !readableType(entry['media-type']) && !seen.has(entry.id)) {
      seen.add(entry.id)
      entry = manifest.get(entry.fallback)
    }
    const path = entry ? zipPath(packagePath, entry.href) : ''
    const cover = entry?.id === coverId || coverPaths.has(path) || hasProperty(entry?.properties, 'cover-image')
    const primary = item.linear !== 'no' && !hasProperty(entry?.properties, 'nav')
    return { path, primary, cover, readable: Boolean(path && readableType(entry?.['media-type'])), label: path || item.idref }
  })
  const paths = new Set(sections.filter(section => section.readable).map(section => section.path))
  const documents = extract(name => paths.has(name))
  const chapters = []
  const missingSections = []
  let charCount = 0
  let markdownBytes = 0
  for (const section of sections) {
    const { path, label, primary } = section
    if (!section.readable || !Object.hasOwn(documents, path)) {
      if (primary && !section.cover) missingSections.push(label)
      continue
    }
    const { heading, text, hasText, hasMedia, cover } = chapterMarkdown(read(documents, path))
    if (!hasText && (cover || section.cover)) continue
    if (primary && hasMedia && !hasText) missingSections.push(label)
    if (!text) continue
    charCount += text.length
    markdownBytes += encoder.encode(text).byteLength
    if (markdownBytes > maxMarkdownBytes) return { status: 413, error: '转换后的 Markdown 超过 8 MB。' }
    chapters.push({ title: heading || `第 ${chapters.length + 1} 节`, text, source: path })
  }
  if (!chapters.length) throw new Error('没有读到文字正文。这本书可能是图片版。')
  return { title, author, charCount, unreadable: missingSections.length, missingSections, chapterCount: chapters.length, chapters }
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
