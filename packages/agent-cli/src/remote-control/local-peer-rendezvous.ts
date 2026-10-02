/**
 * SEC-010 composition (#1862): WHERE the guarded rendezvous lives, and who tears it down.
 *
 * The security leaf owns what `guarded` MEANS and how to build one; it deliberately knows nothing
 * about this host's layout. Choosing the path is composition, and composition is this package.
 *
 * ## Why the runtime directory is preferred over the home directory
 *
 * `XDG_RUNTIME_DIR` is created by the system per login session, already `0700`, and — the part that
 * matters — it is REMOVED when the last session of that user ends. A rendezvous is only meaningful
 * while a session is alive, so a location the system cleans up is a better fit than one that
 * accumulates: a stale socket under the configured user storage root outlives the process that made it and the next run
 * has to reason about whether it is live.
 *
 * The home directory is the fallback rather than the default for the same reason it is the right
 * fallback: this package already keeps host identity and trusted devices under the configured user storage root, so a
 * host with no runtime directory (a bare container, a non-systemd Unix, Windows) still has a
 * per-user place that exists. `ensureGuardedDirectory` then does the work the runtime directory
 * would have done for free — create it, force the mode, and verify.
 *
 * Neither branch is trusted: whichever path is chosen goes through the same judge. That is the
 * point of choosing here and validating there — a location decision cannot accidentally become a
 * security decision.
 */

import { join } from 'node:path';

import {
  ensureGuardedDirectory,
  type ILocalPeerAdmission,
} from '@robota-sdk/agent-remote-pairing/local';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

/** Directory name under whichever root is chosen. */
const RENDEZVOUS_DIR = 'peers';

/**
 * The path this host should use, without creating anything.
 *
 * Separate from creation so a diagnostic can report where the rendezvous WOULD be without the side
 * effect of making it — the host diagnostics command should be able to say what it inspected.
 */
export function resolveRendezvousDirectory(productRuntime: ICliRuntimeContext): string {
  const runtimeDir = productRuntime.environment['XDG_RUNTIME_DIR'];
  const namespace = productRuntime.config.identity.daemonNamespace;
  if (runtimeDir !== undefined && runtimeDir.trim().length > 0) {
    return join(runtimeDir, namespace, RENDEZVOUS_DIR);
  }
  return join(productRuntime.layout.userRoot, RENDEZVOUS_DIR);
}

/**
 * Create the rendezvous directory for this host and verify it, or say why it is not usable.
 *
 * Returns the security leaf's own admission shape rather than a boolean, so a caller cannot lose
 * the distinction between "usable" and "usable, and here is what was established". A refusal here
 * means local peering is unavailable — it is not a reason to fall back to an unguarded directory,
 * which would be the copyable-credential failure SEC-010 exists to prevent, wearing a path.
 */
export function ensureRendezvousDirectory(
  productRuntime: ICliRuntimeContext,
): ILocalPeerAdmission {
  return ensureGuardedDirectory(resolveRendezvousDirectory(productRuntime), {
    expectedUid: process.getuid?.() ?? 0,
  });
}
