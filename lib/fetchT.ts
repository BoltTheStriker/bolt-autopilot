/** fetch with a timeout: a slow upstream API must never hang a page build or an API route. */
export const fetchT = (url: string, init: RequestInit = {}, ms = 8_000) => fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
