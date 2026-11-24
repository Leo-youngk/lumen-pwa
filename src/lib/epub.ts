import type { EpubResult } from '../../worker/epub.mjs'

export type EpubWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; book: EpubResult }
  | { type: 'error'; message: string }

let importer: Worker | undefined

function stopImporter(worker: Worker) {
  worker.terminate()
  if (importer === worker) importer = undefined
}

function getImporter(): Worker {
  if (importer) return importer
  const worker = new Worker(new URL('../workers/epub.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('error', () => stopImporter(worker), { once: true })
  importer = worker
  return worker
}

export function prepareEpubImporter() {
  // WebKit can block creation of a new worker after going offline, even with a cached script.
  try { getImporter() } catch { /* The file picker can retry worker startup. */ }
}

export function importEpub(file: File, onProgress: (done: number, total: number) => void): Promise<EpubResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = getImporter()
    } catch {
      reject(new Error('无法启动本机 EPUB 导入，请重新打开 Lumen 后重试。'))
      return
    }
    const timer = window.setTimeout(() => {
      stopImporter(worker)
      fail('本机导入耗时过长，请保持 Lumen 在前台并重试。')
    }, 90_000)
    function cleanup() {
      window.clearTimeout(timer)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
    }
    function fail(message: string) {
      cleanup()
      reject(new Error(message))
    }
    worker.onmessage = ({ data }: MessageEvent<EpubWorkerMessage>) => {
      if (data.type === 'progress') onProgress(data.done, data.total)
      else if (data.type === 'error') fail(data.message)
      else {
        cleanup()
        resolve(data.book)
      }
    }
    worker.onerror = () => fail('本机 EPUB 解析组件未能加载。请联网打开一次最新版 Lumen 后重试。')
    worker.onmessageerror = () => fail('无法读取本机文件，请先把 EPUB 下载到设备上再导入。')
    try {
      worker.postMessage(file)
    } catch {
      fail('无法读取本机文件，请先把 EPUB 下载到设备上再导入。')
    }
  })
}
