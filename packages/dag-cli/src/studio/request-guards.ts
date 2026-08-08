/**
 * SEC-006 — request guards for the local `dag studio` HTTP server.
 *
 * The studio binds 127.0.0.1, which is NOT an access control: any web page the developer visits can
 * issue cross-origin requests to it, and before this module `/api/dag`, `/api/run` and `/api/validate`
 * each resolved a client-supplied `file` against `cwd` with no containment — so a visited page could
 * read arbitrary JSON from the machine and, via `/api/run`, make the server EXECUTE an arbitrary DAG.
 *
 * Kept in its own module so the containment and origin checks are reviewable on their own, rather than
 * buried among the route handlers.
 */
import { resolve } from 'node:path';

import { canonicalizePath, isPathInside } from '@robota-sdk/agent-core/node';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Whether the request `Host` header is a loopback name (port stripped) — closes DNS rebinding.
 * A missing `Host` is rejected (a well-formed HTTP/1.1 client always sends one).
 */
export function isLoopbackHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.slice(0, host.lastIndexOf(':') === -1 ? host.length : host.lastIndexOf(':'));
  return LOOPBACK_HOSTS.has(name);
}

/**
 * Resolve a CLIENT-SUPPLIED `file` against `cwd` and refuse anything that escapes it.
 *
 * Containment is decided on the CANONICAL (symlink-resolved) paths via agent-core's shared
 * `isPathInside` SSOT: `resolve()` alone is purely lexical, so `<cwd>/link/x.dag.json` where
 * `link -> /etc` passed a `startsWith` check while the subsequent `readFile` followed the link out of
 * the working directory.
 */
export function resolveContainedFile(
  file: string,
  cwd: string,
): { ok: true; path: string } | { ok: false; message: string } {
  const canonical = canonicalizePath(resolve(cwd, file));
  if (!isPathInside(cwd, canonical)) {
    return { ok: false, message: `Access denied: "${file}" is outside the working directory` };
  }
  // Return the CANONICAL path, not the lexical one: the caller reads and executes it, and handing
  // back the unresolved form would mean the path that was validated is not the path that is opened.
  return { ok: true, path: canonical };
}
