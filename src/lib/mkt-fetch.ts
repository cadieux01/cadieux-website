"use client";

// Timeout-bounded fetch for every /mkt client call.
//
// Every /api/mkt/* fetch used to be a bare `fetch(url, {cache:"no-store"})`
// — unbounded. A flaky connection or a slow DB would hang the UI forever
// with a spinner and no way to recover but a page refresh. That was the
// "silent hang" the hardening pass set out to close.
//
// mktFetch wraps every request in an AbortSignal.timeout(). The default
// timeout is 15 s, which is long enough that a legitimate slow query
// still completes (DB-side medians are 193–684 ms today) and short
// enough that a dead connection surfaces as a visible error before the
// operator thinks the page is broken.
//
// On timeout or network error the returned Error.message is an
// operator-readable sentence rather than the AbortError's cryptic
// "The operation was aborted" — so a caller that just forwards
// e.message into a <PaneError> renders something the operator can act
// on.

export class MktFetchError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(message: string, url: string, status = 0) {
    super(message);
    this.name = "MktFetchError";
    this.url = url;
    this.status = status;
  }
}

export interface MktFetchOptions extends Omit<RequestInit, "signal"> {
  /** Timeout in ms. Default: 15000. 0 disables. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j && typeof j.error === "string" && j.error) return j.error;
    } catch {
      /* fall through */
    }
    return `HTTP ${res.status}: ${text.slice(0, 300)}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Fetch a /api/mkt/* URL with a timeout. Throws MktFetchError on
 *  non-2xx, timeout, or network failure. Caller can catch and read
 *  .message straight to the error pane. */
export async function mktFetch<T = unknown>(
  url: string,
  options: MktFetchOptions = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...rest } = options;
  const controller =
    timeoutMs > 0 ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort("timeout"), timeoutMs)
    : null;

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      cache: options.cache ?? "no-store",
      headers,
      signal: controller?.signal,
    });
  } catch (e) {
    // Abort or network error. The AbortError message is cryptic; swap
    // in a readable sentence so <PaneError> doesn't shout at the
    // operator.
    const isAbort =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (isAbort) {
      throw new MktFetchError(
        `Request timed out after ${timeoutMs}ms`,
        url,
        0,
      );
    }
    throw new MktFetchError(
      e instanceof Error ? e.message : "Network error",
      url,
      0,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!res.ok) {
    const msg = await readError(res);
    throw new MktFetchError(msg, url, res.status);
  }

  if (res.status === 204) return undefined as T;
  // The API routes always return JSON; falling through to .json() is
  // safe, and bare bodies would be a route bug.
  return (await res.json()) as T;
}

/** POST a JSON body + handle the timeout + stringify + Content-Type. */
export async function mktPost<T = unknown>(
  url: string,
  body: unknown,
  options: Omit<MktFetchOptions, "method" | "body"> = {},
): Promise<T> {
  return mktFetch<T>(url, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

/** PATCH a JSON body — same shape as mktPost. */
export async function mktPatch<T = unknown>(
  url: string,
  body: unknown,
  options: Omit<MktFetchOptions, "method" | "body"> = {},
): Promise<T> {
  return mktFetch<T>(url, {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    body: JSON.stringify(body),
  });
}
