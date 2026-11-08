import { lstat, open, readlink, realpath, type FileHandle } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { isPathInside } from '@robota-sdk/agent-core/node';

import type { IToolInvocationResult } from '../types/tool-result.js';

/**
 * Returns a JSON-serialized IToolInvocationResult error when filePath is outside cwd, or when NO
 * containment root is configured. Returns undefined only when the path is inside a configured root.
 *
 * This sentence used to end "or cwd is not set" — the fail-open default ARCH-010 removed. It sat
 * directly above the two functions that implement the distinction, which is the worst place for a
 * comment to say the opposite of the code.
 *
 * SEC-006: containment is decided on the CANONICAL (symlink-resolved) paths, via the shared
 * `isPathInside` SSOT in agent-core. A purely lexical `resolve()` + `startsWith` comparison let
 * `<cwd>/link/secret` through when `link -> /etc`, because `resolve` does not consult the filesystem
 * and so cannot see a symlink — while the subsequent `readFile`/`writeFile` followed the link out of
 * the sandbox. For `Write`/`Edit` that meant creating files anywhere the process could reach, and
 * since symlinks are ordinary committed git content, pointing the agent at an untrusted clone was
 * enough to arm it.
 *
 * The same defect existed in the CLI's monitor asset server; both now share one implementation,
 * because two containment checks that can disagree are their own defect.
 */
/**
 * Whether a host path is inside the tool's containment root — the single predicate every builtin
 * asks, whatever it does with the answer.
 *
 * `checkPathWithinCwd` turns a `false` into the tool-result error a tool RETURNS; the enumerating
 * tools (`Glob`, `Grep`) instead SKIP the entry mid-walk and must not fabricate an error per file.
 * Both ask this one question, which asks agent-core's `isPathInside` SSOT — so there is no second
 * containment rule that could disagree with the first (SEC-006's stated defect, SEC-007 keeping it
 * true as the guard's reach widens).
 *
 * `cwd === undefined` means no containment root is configured, and the answer is NO — ARCH-010.
 *
 * This used to return `true` there: with no root, everything was inside it. A guard whose default is
 * "allow" is not a guard, it is a guard that has to be remembered, and the architecture audit found
 * three independent layers that had forgotten. `pack-coding` had already written the consequence into
 * its own source — "file tools constructed with no options carry a DISARMED working-directory guard:
 * their `Read` will happily return `/etc/hostname`" — and the child-process subagent worker called
 * `createDefaultTools()` with no argument, so a subagent got exactly that. Measured, not inferred:
 * before this change a rootless `Read` of `/etc/hostname` returned the file.
 *
 * Refusing instead means a construction site that forgets the root fails loudly on its first file
 * access rather than silently running unconfined. The root is also required by the tool factories now,
 * so reaching this branch at all is an assembly bug — which is why the error says so specifically
 * rather than reporting an ordinary out-of-root path.
 */
export function isWithinCwd(filePath: string, cwd: string | undefined): boolean {
  if (cwd === undefined) return false;
  return isPathInside(cwd, filePath);
}

/**
 * Where a RELATIVE host path the model supplied is anchored: the containment root, never
 * `process.cwd()` (issue #2429). `Read`/`Write`/`Edit` declare `filePath` absolute, but nothing
 * makes the model comply, and `isPathInside` canonicalises a relative candidate against the PROCESS
 * directory — so a relative path was confined to one root and judged against another. Same rule as
 * `resolveSearchRoot` for the enumerating tools. With no root there is nothing to anchor to; the path
 * is returned as written and `checkPathWithinCwd` refuses it (ARCH-010).
 */
export function resolveHostPath(filePath: string, cwd: string | undefined): string {
  if (cwd === undefined) return filePath;
  return resolve(cwd, filePath);
}

export function checkPathWithinCwd(filePath: string, cwd: string | undefined): string | undefined {
  if (cwd === undefined) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error:
        `Access denied: "${filePath}" cannot be checked because no containment root is ` +
        'configured for this tool. This is an assembly bug, not a path problem — the tool was ' +
        'constructed without a `cwd`, so it has no boundary to enforce (ARCH-010).',
    };
    return JSON.stringify(result);
  }

  if (!isWithinCwd(filePath, cwd)) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Access denied: "${filePath}" is outside the working directory`,
    };
    return JSON.stringify(result);
  }

  return undefined;
}

/** The opened file is not confirmed inside the containment root; the message words why. */
export class ContainmentEscapeError extends Error {}

/** macOS `O_NOFOLLOW_ANY`: the open fails with `ELOOP` if ANY component of the path is a symlink. */
const DARWIN_O_NOFOLLOW_ANY = 0x20000000;

/** Whether canonical `candidate` is canonical `root` or beneath it, compared as text only. */
function isCanonicalInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Windows half of {@link openWithinCwd}. A Windows handle carries no path, so the file opened is
 * confirmed by identity instead: the canonical path is checked inside `root` and its file index read
 * BEFORE the open, and the handle must name that same file (same volume, same file index). A link
 * swapped in before the open leads the open to another file and fails the comparison; a swap after the
 * open cannot change what the handle reads. A file index of 0 means the filesystem reports no
 * identity, so nothing can be compared and the open is refused.
 */
async function openWithinCwdWindows(
  filePath: string,
  flags: number,
  root: string,
): Promise<FileHandle> {
  const canonical = await realpath(filePath);
  if (!isCanonicalInside(root, canonical)) {
    throw new ContainmentEscapeError(
      `Access denied: "${filePath}" is outside the working directory`,
    );
  }
  const named = await lstat(canonical, { bigint: true });
  const handle = await open(filePath, flags, 0o600);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.ino === 0n || opened.ino !== named.ino || opened.dev !== named.dev) {
      throw new ContainmentEscapeError(
        `Access denied: "${filePath}" cannot be confirmed inside the working directory`,
      );
    }
    return handle;
  } catch (err) {
    await handle.close();
    throw err;
  }
}

/**
 * Open a host file so that containment is decided on the file actually opened, not on a path checked
 * before the open — a path swapped for a link between the two would otherwise be followed out of the
 * root (issue #3252).
 *
 * - macOS opens the canonical path with `O_NOFOLLOW_ANY`: a canonical path contains no links, so a
 *   link appearing anywhere along it after canonicalisation makes the open fail instead of follow.
 * - Linux reads the kernel's path for the opened descriptor (`/proc/self/fd/N`); re-canonicalising it
 *   would consult the filesystem again. Without procfs the answer cannot be confirmed, so the open is
 *   refused.
 * - Windows gives an open handle no path, so the opened file is confirmed by identity: the handle must
 *   be the file the canonical path named, inside the root, just before the open.
 * - Elsewhere the containment check before the open is the only check.
 *
 * Both sides of the comparison come from the native `realpath`, which spells a path as it is on disk;
 * a root typed in another letter case or Unicode normalization still names the same directory.
 *
 * Throws {@link ContainmentEscapeError} on an escape; any other open error propagates as thrown.
 */
export async function openWithinCwd(
  filePath: string,
  cwd: string | undefined,
  flags: number,
): Promise<FileHandle> {
  const outside = (): ContainmentEscapeError =>
    new ContainmentEscapeError(`Access denied: "${filePath}" is outside the working directory`);
  if (cwd === undefined) throw outside();
  const root = await realpath(cwd);
  if (process.platform === 'darwin') {
    const canonical = await realpath(filePath);
    if (!isCanonicalInside(root, canonical)) throw outside();
    try {
      // The mode is a no-op without O_CREAT; it is passed so the open states an owner-only mode,
      // which is what static analysis looks for on an open.
      return await open(canonical, flags | DARWIN_O_NOFOLLOW_ANY, 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ELOOP') throw outside();
      throw err;
    }
  }
  if (process.platform === 'win32') return openWithinCwdWindows(filePath, flags, root);
  const handle = await open(filePath, flags, 0o600);
  if (process.platform !== 'linux') return handle;
  let opened: string;
  try {
    opened = await readlink(`/proc/self/fd/${handle.fd}`);
  } catch {
    // allow-fallback: no procfs means containment of the opened file cannot be confirmed — refused,
    // never read unconfirmed.
    await handle.close();
    throw new ContainmentEscapeError(
      `Access denied: "${filePath}" cannot be confirmed inside the working directory without /proc`,
    );
  }
  if (isCanonicalInside(root, opened)) return handle;
  await handle.close();
  throw outside();
}

/**
 * Resolve an LLM-supplied search root for an ENUMERATING tool, and refuse one that escapes (SEC-007).
 *
 * A relative `requested` anchors to the CONTAINMENT ROOT, not to `process.cwd()`: anchoring them to
 * two different directories is how a "contained" search silently starts somewhere else. `error`
 * carries the tool-result JSON to return, or is `undefined` when the root is allowed.
 *
 * With no root there is nothing to anchor to, so this refuses rather than reaching for the process
 * directory (ARCH-010). The previous `cwd ?? process.cwd()` was that reach: harmless once the guard
 * below refuses anyway, but it read as a supported fallback, which is the pattern being removed.
 */
export function resolveSearchRoot(
  requested: string | undefined,
  cwd: string | undefined,
): { root: string; error: string | undefined } {
  if (cwd === undefined) {
    return { root: '', error: checkPathWithinCwd(requested ?? '', undefined) };
  }
  const root = requested ? resolve(cwd, requested) : cwd;
  return { root, error: checkPathWithinCwd(root, cwd) };
}
