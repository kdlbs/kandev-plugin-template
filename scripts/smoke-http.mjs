import assert from 'node:assert/strict';

export async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw Object.assign(new Error(`${options.method || 'GET'} ${path}: ${response.status} ${await response.text()}`), { status: response.status });
  }
  return response;
}

export async function eventually(check, message, { timeoutMs = 20000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      // Retry only temporary server/transport failures, not auth failures or
      // programming errors in the check itself.
      const retryable = [502, 503, 504].includes(error?.status) ||
        (error instanceof TypeError && error.message === 'fetch failed');
      if (!retryable) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  assert.fail(lastError ? `${message}: ${lastError.message}` : message);
}
