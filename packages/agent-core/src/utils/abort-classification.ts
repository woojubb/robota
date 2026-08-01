/**
 * CORE-027 — was this failure an ABORT, or did it merely say so?
 *
 * Three call sites classified it the same wrong way:
 *
 *   error.name === 'AbortError' || error.message.includes('aborted') || error.message.includes('abort')
 *
 * The substring test is a guess about prose. A provider failure whose message happens to contain
 * those letters — "the upstream aborted the stream after a policy check", "AbortController is not
 * supported by this runtime", a remote 5xx body quoting the word — was classified as a user
 * interruption, and `execution-service.ts` then returned `success: true, interrupted: true` for it.
 * A real failure reported as a successful interrupted run is the sharpest kind of silent wrong
 * answer: nothing downstream, including the print-mode exit code, has any way to tell.
 *
 * The authoritative signal is the one the caller already holds. An abort happens because SOMETHING
 * ABORTED — the `AbortSignal` that was passed in says so, and the platform's own abort errors carry
 * `name === 'AbortError'`. Neither is a guess about wording, and both are things the abort mechanism
 * actually produces.
 *
 * `DOMException` with `name === 'AbortError'` is covered by the name test; `undici` and `node:fetch`
 * both raise it that way, as does `AbortSignal.throwIfAborted()`.
 */
/**
 * Whether a value is error-SHAPED, without asking which realm or prototype chain it came from.
 *
 * `instanceof Error` is not a safe test here for two independent reasons, and only one of them was
 * raised in review:
 *
 * - **Cross-realm.** An error thrown in a worker, a `vm` context, or a different iframe fails
 *   `instanceof` against this realm's `Error` even when it is a perfectly ordinary error.
 * - **`DOMException`.** Review claimed it does not extend `Error`. On this runtime it does —
 *   measured on Node 22.14: `new DOMException('x','AbortError') instanceof Error === true`, and
 *   WebIDL has put `Error.prototype` in its chain since 2021. So the claim does not hold here. But
 *   `agent-core` ships a BROWSER build too, and nothing is gained by depending on that being true
 *   everywhere when the structural test costs a line.
 *
 * A bare `{ name: 'AbortError' }` is still not an abort: an error carries a message.
 */
function isErrorShaped(
  value: unknown,
): value is { name: string; message: string; cause?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

export function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
  // The caller's own signal is the fact. If it is aborted, the round ended because of that,
  // whatever the provider's error text says.
  if (signal?.aborted === true) return true;
  if (!isErrorShaped(error)) return false;
  // What the platform raises for an abort. Checked on the ERROR OBJECT, never on its prose.
  if (error.name === 'AbortError') return true;
  // A wrapped abort keeps the original as its cause; one level is enough for the wrappers here.
  const cause: unknown = error.cause;
  return isErrorShaped(cause) && cause.name === 'AbortError';
}
