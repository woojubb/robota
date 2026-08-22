import { randomUUID } from 'node:crypto';

/**
 * SEC-006 — session ids are used as PATH SEGMENTS (`<baseDir>/<id>.json`, `<logDir>/<id>.jsonl`,
 * `<rootDir>/<id>/` for checkpoints), and at least one caller supplies one from an untrusted source:
 * `POST /api/playground/sessions` reads `resumeSessionId` from an unauthenticated HTTP body and checks
 * only `typeof === 'string'`. An id of `../../x` therefore escaped the store directory on both read
 * and write.
 *
 * The guard lives at the id boundary rather than at each `join()` so every sink inherits it — the store,
 * the JSONL logger and the replay-log reader are three separate sinks on the same value.
 *
 * REJECT rather than sanitize: silently rewriting `../x` to `__x` would alias two distinct ids onto one
 * file, quietly cross-linking sessions. A malformed id is a bug or an attack; both should be loud.
 */

/** Ids the app generates: `session_<uuid>`. This matches the path-component guard below. */
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Generous, but bounded well under every filesystem's per-component limit (255 bytes). */
const MAX_SESSION_ID_LENGTH = 128;

/** Generate a fresh session id for callers that do not provide one explicitly. */
export function createSessionId(): string {
  return `session_${randomUUID()}`;
}

/**
 * Whether `id` is safe to interpolate into a filesystem path as a single component.
 *
 * The pattern admits no `/`, no `\` and no `:`, so the value cannot introduce a path separator or a
 * Windows drive qualifier; and because it must start with an alphanumeric, it can be neither `.` nor
 * `..`. With no separator available, an embedded `..` cannot form a traversal component.
 */
export function isSafeSessionId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_SESSION_ID_LENGTH && SAFE_SESSION_ID.test(id);
}

/** Throw unless `id` is safe to use as a path component. */
export function assertSafeSessionId(id: string): void {
  if (!isSafeSessionId(id)) {
    throw new Error(
      `Invalid session id: ${JSON.stringify(id)}. A session id must be 1-${MAX_SESSION_ID_LENGTH} ` +
        'characters of letters, digits, dot, underscore or hyphen, starting with a letter or digit.',
    );
  }
}
