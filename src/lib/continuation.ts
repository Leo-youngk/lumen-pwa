export function continuationQuestion(question: string, answer: string, contextTokens?: number): string {
  const limit = Math.min(6000, Math.floor((contextTokens ?? 16_384) / 12))
  const tail = answer.slice(-Math.max(120, limit)).replace(/^[\uDC00-\uDFFF]/, '')
  return [
    question,
    '以下是已生成回答的结尾。请从断点接着写，保留原有结构。只输出后续正文，不要重写已有内容或加开场白。',
    '<已生成正文>',
    tail,
    '</已生成正文>',
  ].join('\n\n')
}

/** Buffer the first deltas while they may repeat the end of the existing reply. */
export function continuationWriter(previous: string, write: (text: string) => void) {
  const tail = previous.slice(-2048).trimEnd()
  let opening = ''
  let started = false
  function flush(final: boolean) {
    if (started || !opening) return
    const text = opening.trimStart()
    if (!final && text.length < tail.length && (text.length < 8 || tail.includes(text))) return
    let overlap = Math.min(tail.length, text.length)
    while (overlap >= 8 && !text.startsWith(tail.slice(-overlap))) overlap--
    const next = overlap >= 8 ? text.slice(overlap) : opening
    opening = ''
    started = true
    if (next) write(next)
  }
  return {
    push(text: string) {
      if (started) write(text)
      else {
        opening += text
        flush(false)
      }
    },
    finish() { flush(true) },
  }
}
