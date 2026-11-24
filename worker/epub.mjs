import { unzipSync } from 'fflate'
import { parse as parseHtml } from 'parse5'
import { SaxesParser } from 'saxes'

const mib = 1024 * 1024
export const maxEpubBytes = 64 * mib
const encoder = new TextEncoder()

export class EpubError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.status = status
  }
}

function xml(source, visit, close) {
  // Older books can have undeclared metadata prefixes but still well-formed XML.
  const parser = new SaxesParser()
  parser.ENTITIES.nbsp = '\u00a0'
  const localName = name => name.split(':').at(-1)
  const values = []
  parser.on('opentag', node => {
    visit(localName(node.name), Object.fromEntries(
      Object.entries(node.attributes).map(([name, value]) => [localName(name), value])
    ))
    if (close) values.push('')
  })
  if (close) {
    parser.on('text', text => { if (values.length) values[values.length - 1] += text })
    parser.on('cdata', text => { if (values.length) values[values.length - 1] += text })
    parser.on('closetag', node => {
      const value = values.pop()
      if (values.length) values[values.length - 1] += value
      close(localName(node.name), value.trim())
    })
  }
  parser.write(source).close()
}

function zipPath(parent, path, decode = true) {
  if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return ''
  let relative = path.trim().split(/[?#]/, 1)[0]
  if (decode) {
    try { relative = decodeURIComponent(relative) } catch { /* Literal percent signs occur in older books. */ }
  }
  relative = relative.replace(/\\/g, '/')
  const parts = relative.startsWith('/') ? [] : parent.replace(/\\/g, '/').split('/').slice(0, -1).filter(part => part && part !== '.')
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (!parts.length) return ''
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
const readableEntry = entry => Boolean(entry && (
  /^(application\/xhtml\+xml|text\/html|image\/svg\+xml)$/i.test(entry['media-type'] ?? '')
  || /\.(xhtml?|html?|svg)(?:[?#]|$)/i.test(entry.href ?? '')
))

function decodeText(data) {
  const [first, second, third, fourth] = data
  let encoding = 'utf-8'
  if ((first === 0xfe && second === 0xff) || (first === 0 && second === 0x3c && third === 0)) encoding = 'utf-16be'
  else if ((first === 0xff && second === 0xfe) || (first === 0x3c && second === 0 && fourth === 0)) encoding = 'utf-16le'
  else {
    const header = new TextDecoder().decode(data.subarray(0, 2048))
    encoding = header.match(/^\s*<\?xml[^?]*?\bencoding\s*=\s*["']([^"']+)["']/i)?.[1]
      ?? header.match(/<meta\b[^>]*?\bcharset\s*=\s*["']?([\w-]+)/i)?.[1] ?? encoding
  }
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(data)
  } catch {
    throw new EpubError('书内有无法解码的文件，请重新导出为 UTF-8 版 EPUB。')
  }
}

function chapterMarkdown(html) {
  const body = parseHtml(html).childNodes.find(node => node.tagName === 'html')
    ?.childNodes.find(node => node.tagName === 'body')
  let heading = ''
  let hasText = false
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
      const alt = attr(node, 'alt') || attr(node, 'aria-label')
      return alt?.trim() ? `[图片：${escapeMarkdown(alt.trim())}]` : ''
    }
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
  return { heading, text, hasText, cover }
}

export function parseEpub(bytes, { expandedLimit = 24 * mib, markdownLimit = 12 * mib, progress } = {}) {
  if (!bytes.length) throw new EpubError('EPUB 文件是空的，请先完整下载。')
  if (bytes.length > maxEpubBytes) throw new EpubError('本机导入最大支持 64 MB 的 EPUB。', 413)
  const entries = new Set()
  const normalized = new Map()
  try {
    unzipSync(bytes, { filter: ({ name }) => {
      if (entries.has(name)) throw new EpubError('EPUB 内有重复文件，请重新导出这本书。')
      entries.add(name)
      const key = name.replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '').toLowerCase()
      normalized.set(key, normalized.has(key) ? null : name)
      return false
    } })
  } catch (error) {
    if (error instanceof EpubError) throw error
    throw new EpubError('文件不是完整的 EPUB 压缩包，请重新下载后导入。')
  }
  const locate = (parent, href) => {
    const paths = [zipPath(parent, href), zipPath(parent, href, false)].filter(Boolean)
    return paths.find(path => entries.has(path))
      ?? paths.map(path => normalized.get(path.toLowerCase())).find(Boolean) ?? ''
  }
  let expanded = 0
  let count = 0
  const extract = paths => unzipSync(bytes, { filter: ({ name, originalSize }) => {
    if (!paths.has(name)) return false
    expanded += originalSize
    if (expanded > expandedLimit || ++count > 3000) throw new EpubError('EPUB 解压后的正文过大，请拆分这本书后导入。', 413)
    return true
  } })
  const readXml = (files, path, visit, close) => {
    try {
      xml(decodeText(files[path]), visit, close)
    } catch (error) {
      if (error instanceof EpubError) throw error
      throw new EpubError('书内的 ' + path.split('/').at(-1) + ' 格式有误，请重新下载或导出 EPUB。')
    }
  }
  const container = locate('', 'META-INF/container.xml')
  const encryption = locate('', 'META-INF/encryption.xml')
  const metadata = extract(new Set([container, encryption].filter(Boolean)))
  const rootFiles = []
  if (container) {
    readXml(metadata, container, (tag, a) => {
      if (tag === 'rootfile') rootFiles.push(a)
    })
  }
  let packagePath = rootFiles.filter(a => a['media-type'] === 'application/oebps-package+xml')
    .concat(rootFiles).map(a => locate('', a['full-path'])).find(Boolean)
  if (!packagePath) {
    const candidates = [...entries].filter(name => /\.opf$/i.test(name))
    if (candidates.length === 1) packagePath = candidates[0]
  }
  if (!packagePath) throw new EpubError('EPUB 缺少书籍清单，请重新下载或导出 EPUB。')
  if (encryption) {
    let encryptedContent = false
    readXml(metadata, encryption, (tag, a) => {
      if (tag === 'CipherReference' && !/\.(otf|ttf|woff2?)$/i.test(zipPath('', a.URI))) encryptedContent = true
    })
    if (encryptedContent) throw new EpubError('这本 EPUB 受版权加密保护，请选择可直接读取正文的 EPUB。')
  }
  const manifest = new Map()
  const spine = []
  const coverPaths = new Set()
  let coverId = ''
  let title = ''
  let author = ''
  readXml(extract(new Set([packagePath])), packagePath, (tag, a) => {
    if (tag === 'item') manifest.set(a.id, a)
    if (tag === 'itemref') spine.push(a)
    if (tag === 'meta' && a.name === 'cover') coverId = a.content
    if (tag === 'reference' && hasProperty(a.type, 'cover')) coverPaths.add(locate(packagePath, a.href))
  }, (tag, value) => {
    if (tag === 'title' && !title) title = value
    if (tag === 'creator' && !author) author = value
  })
  const sections = spine.map(item => {
    let entry = manifest.get(item.idref)
    const seen = new Set()
    while (entry?.fallback && !readableEntry(entry) && !seen.has(entry.id)) {
      seen.add(entry.id)
      entry = manifest.get(entry.fallback)
    }
    const path = entry ? locate(packagePath, entry.href) : ''
    const cover = entry?.id === coverId || Boolean(path && coverPaths.has(path)) || hasProperty(entry?.properties, 'cover-image')
    const nav = hasProperty(entry?.properties, 'nav')
    const primary = item.linear !== 'no' && !nav
    return { path, primary, cover, nav, readable: Boolean(path && readableEntry(entry)), label: path || entry?.href || item.idref || '未知章节' }
  })
  if (!sections.length) throw new EpubError('EPUB 的书籍清单没有章节，请重新导出这本书。')
  const paths = new Set(sections.filter(section => section.readable).map(section => section.path))
  const documents = extract(paths)
  const chapters = []
  const missingSections = []
  let charCount = 0
  let markdownBytes = 0
  let hasBodyText = false
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]
    if (index % 16 === 0) progress?.(index, sections.length)
    const { path, label, primary } = section
    if (!section.readable || !Object.hasOwn(documents, path)) {
      if (primary && !section.cover) missingSections.push(label)
      continue
    }
    let chapter
    try {
      chapter = chapterMarkdown(decodeText(documents[path]))
    } catch {
      if (!section.cover) missingSections.push(label)
      continue
    }
    const { heading, text, hasText, cover } = chapter
    if (!hasText && (cover || section.cover)) continue
    if (primary && !hasText) missingSections.push(label)
    if (!text) continue
    hasBodyText ||= hasText && !section.nav && !cover && !section.cover
    charCount += text.length
    markdownBytes += encoder.encode(text).byteLength
    if (markdownBytes > markdownLimit) throw new EpubError('转换后的正文过大，请拆分这本书后导入。', 413)
    chapters.push({ title: heading || `第 ${chapters.length + 1} 节`, text, source: path })
  }
  if (!hasBodyText) throw new EpubError('没有提取到文字正文。扫描版 EPUB 需先转成可选中文字的版本。')
  return { title, author, charCount, unreadable: missingSections.length, missingSections, chapterCount: chapters.length, chapters }
}

export async function handleEpub(request) {
  // Older installed clients still send the file to this endpoint.
  const headers = { 'Cache-Control': 'no-store' }
  if (!request.body) return Response.json({ error: '没有收到 EPUB 文件。' }, { status: 400, headers })
  const reader = request.body.getReader()
  try {
    const chunks = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 16 * mib) {
        void reader.cancel().catch(() => {})
        throw new EpubError('旧版上传最大支持 16 MB，请更新应用后在本机导入。', 413)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return Response.json(parseEpub(bytes, { expandedLimit: 14 * mib, markdownLimit: 8 * mib }), { headers })
  } catch (error) {
    if (error instanceof EpubError) return Response.json({ error: error.message }, { status: error.status, headers })
    return Response.json({ error: '电子书上传中断或内部文件损坏，请更新应用后在本机导入。' }, { status: 422, headers })
  } finally {
    reader.releaseLock()
  }
}
