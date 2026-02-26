export function createRequestSignal(
  userSignal?: AbortSignal | null,
  timeoutMs?: number,
): AbortSignal | undefined {
  if (!userSignal && !timeoutMs) return undefined;

  const controller = new AbortController();

  if (timeoutMs && timeoutMs > 0) {
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  }

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener('abort', () => controller.abort(userSignal.reason), {
        once: true,
      });
    }
  }

  return controller.signal;
}
