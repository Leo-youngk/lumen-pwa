const transientCodes = new Set([
  'transport_interrupted', 'upstream_interrupted', 'upstream_timeout', 'upstream_unavailable', 'rate_limit',
])

function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    function abort() {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function retryModel(task, signal, { canRetry, onRetry } = {}) {
  signal.throwIfAborted()
  try {
    return await task()
  } catch (error) {
    signal.throwIfAborted()
    if (!transientCodes.has(error?.code) || canRetry?.(error) === false) throw error
    const delay = Math.max(error.code === 'rate_limit' ? 2000 : 650, error.retryAfterMs ?? 0)
    if (delay > 10_000) throw error
    onRetry?.()
    await waitForRetry(delay, signal)
    signal.throwIfAborted()
    return task()
  }
}
