import { apiFetch } from '../config';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiFetchWithRetry(path, options = {}, retryConfig = {}) {
  const retries = Number.isInteger(retryConfig.retries) ? retryConfig.retries : 2;
  const baseDelayMs = Number.isInteger(retryConfig.baseDelayMs) ? retryConfig.baseDelayMs : 300;

  let attempt = 0;
  while (attempt <= retries) {
    try {
      const response = await apiFetch(path, options);
      const shouldRetry = !response.ok && (response.status >= 500 || response.status === 429);

      if (!shouldRetry || attempt === retries) {
        return response;
      }
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
    }

    await sleep(baseDelayMs * (2 ** attempt));
    attempt += 1;
  }

  return apiFetch(path, options);
}
