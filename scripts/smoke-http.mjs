import assert from 'node:assert/strict';

export async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, signal: options.signal ?? AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw Object.assign(new Error(`${options.method || 'GET'} ${path}: ${response.status} ${await response.text()}`), { status: response.status });
  }
  return response;
}

export async function eventually(check, message, { timeoutMs = 20000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  let lastError;
  while (Date.now() < deadline) {
    try {
      const matched = await check(signal);
      lastError = undefined;
      if (matched && !signal.aborted && Date.now() < deadline) return;
    } catch (error) {
      if (signal.aborted) { lastError = signal.reason; break; }
      // Retry only temporary server/transport failures, not auth failures or
      // programming errors in the check itself.
      const retryable = [502, 503, 504].includes(error?.status) ||
        (error instanceof TypeError && error.message === 'fetch failed');
      if (!retryable) throw error;
      lastError = error;
    }
    // Do not shorten the interval and then start a new HTTP attempt with only
    // a few milliseconds left. Finish after the last full polling interval.
    const remaining = Math.max(0, deadline - Date.now());
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    if (remaining <= intervalMs) break;
  }
  assert.fail(lastError ? `${message}: ${lastError.message}` : message);
}
