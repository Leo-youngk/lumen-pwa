export function retryModel<T>(
  task: () => Promise<T>,
  signal: AbortSignal,
  options?: { canRetry?: (failure: unknown) => boolean; onRetry?: () => void },
): Promise<T>
