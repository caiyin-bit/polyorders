export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function fetchJson<T>(url: string, retries = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 429 && res.status < 500) {
        throw new HttpError(`HTTP ${res.status} for ${url}`, false);
      }
      lastError = new HttpError(`HTTP ${res.status} for ${url}`, true);
    } catch (err) {
      if (err instanceof HttpError && !err.retryable) throw err;
      lastError = err;
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  throw lastError;
}

export function createLimiter(concurrency: number, intervalMs: number) {
  let active = 0;
  let lastStart = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active++;
    const now = Date.now();
    const wait = Math.max(0, lastStart + intervalMs - now);
    lastStart = now + wait;
    if (wait > 0) await sleep(wait);
  }

  function release(): void {
    active--;
    waiters.shift()?.();
  }

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return acquire()
      .then(fn)
      .finally(release);
  };
}
