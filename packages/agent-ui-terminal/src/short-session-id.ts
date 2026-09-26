/** Every stored session id starts with this, so it tells no two sessions apart. */
const SESSION_ID_PREFIX = 'session_';
const SHORT_SESSION_ID_LENGTH = 8;

/** A session id short enough for a picker row or a status bar: the start of the part that differs. */
export function shortSessionId(id: string): string {
  const distinct = id.startsWith(SESSION_ID_PREFIX) ? id.slice(SESSION_ID_PREFIX.length) : id;
  return distinct === '' ? id : distinct.slice(0, SHORT_SESSION_ID_LENGTH);
}
