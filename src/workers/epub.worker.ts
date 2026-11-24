import { EpubError, maxEpubBytes, parseEpub } from '../../worker/epub.mjs'
import type { EpubWorkerMessage } from '../lib/epub'

const post = (message: EpubWorkerMessage) => self.postMessage(message)

self.onmessage = async ({ data: file }: MessageEvent<File>) => {
  if (file.size > maxEpubBytes) {
    post({ type: 'error', message: '本机导入最大支持 64 MB 的 EPUB。请拆分文件后重试。' })
    return
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    post({ type: 'error', message: '无法读取 EPUB。请确认文件已完整下载到设备后重试。' })
    return
  }
  try {
    const book = parseEpub(bytes, { progress: (done, total) => post({ type: 'progress', done, total }) })
    post({ type: 'done', book })
  } catch (failure) {
    const message = failure instanceof EpubError ? failure.message
      : 'EPUB 内部文件不完整或格式不受支持，请重新下载或导出 EPUB。'
    post({ type: 'error', message })
  }
}
