/**
 * SEC-010: proving a local peer shares this environment, using a fact the KERNEL enforces rather
 * than an artifact the peer presents.
 *
 * This is the whole point of the design. Every other admission mechanism in this package proves
 * POSSESSION — of a pairing secret, of an identity private key — and possession is copyable, so it
 * cannot carry the claim "the peer is on this machine, as this user". A copied credential admits
 * whoever obtained it, from wherever they run it.
 *
 * MEASURED, AND IT CHANGED THE DESIGN. The first version of this file asked the kernel to NAME the
 * peer, through `SO_PEERCRED` on the connected socket. Node does not expose it: probed on this
 * runtime, a connected `net.Socket`'s handle carries no `getpeercred` and no peer-credential
 * accessor under any name. That version would have compiled, passed a mocked test, and refused
 * every real peer — a security mechanism that is merely inert is worse than none, because the
 * feature above it looks implemented.
 *
 * So the evidence is the other half of the same kernel guarantee. A Unix socket inside a directory
 * OWNED BY THIS USER AND MODE 0700 cannot be reached by another account at all — the kernel refuses
 * the traversal. Where `SO_PEERCRED` would say "the peer is uid N", this says "no uid but ours could
 * have got here", and for an admission decision those are the same answer reached from opposite
 * sides. It is the mechanism an SSH agent socket and a Docker socket already rely on.
 *
 * What the swap gives up, stated rather than glossed: the peer's uid and pid are never learned, so
 * an audit record cannot name the process on the other end. Admission does not need that; a future
 * diagnostic might, and would need a native addon to get it.
 *
 * NODE-ONLY, DELIBERATELY. The rest of this package is isomorphic (WebCrypto, no Node built-ins) and
 * runs in the Stage-D browser client. This file needs `node:fs`, so it lives behind the `/local`
 * subpath — a browser has no local peers and no filesystem to be judged.
 */

import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * The trust level an admission carries, as a closed vocabulary rather than a boolean.
 *
 * #1810 asks the consumer to receive "a narrow typed authenticated-peer/admission result, not a
 * generic boolean", and the reason is visible here: `same-user-same-host` and `unproven` are not two
 * values of one flag, they are different security situations, and a caller that treats them alike
 * has lost the distinction this item exists to create.
 */
export type TLocalPeerTrust = 'same-user-same-host' | 'unproven';

/** What was established about the rendezvous the peer had to reach. */
export interface ILocalPeerBinding {
  /** The socket path admission is bound to, fully resolved — no symlink may stand in for it. */
  readonly socketPath: string;
  /** The directory whose ownership and mode are the evidence. */
  readonly guardedDirectory: string;
  /** The uid the guarded directory belongs to; by construction, the only account that can connect. */
  readonly ownerUid: number;
}

export interface ILocalPeerAdmission {
  readonly admitted: boolean;
  readonly trust: TLocalPeerTrust;
  /** Present only when the guarantee held. Absent is not "unknown but probably fine". */
  readonly binding?: ILocalPeerBinding;
  /** Why admission was refused, for the operator. Absent when admitted. */
  readonly reason?: string;
}

/**
 * A refusal, built in one place so no call site can accidentally construct an admitted-looking
 * result with no evidence behind it.
 */
export function refuseLocalPeer(reason: string): ILocalPeerAdmission {
  return { admitted: false, trust: 'unproven', reason };
}

/** Mode bits that would let anyone outside the owner reach into the directory. */
const GROUP_OR_OTHER = 0o077;

interface IStatLike {
  uid: number;
  mode: number;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
}

export interface IGuardedDirectoryOptions {
  /** The uid this process runs as. Injected so the decision is testable without spoofing a process. */
  readonly expectedUid: number;
  /** Stat reader, injected for the same reason. */
  readonly statAt?: (target: string) => IStatLike;
  /** Symlink resolver, injected so the resolution step itself can be exercised. */
  readonly resolve?: (target: string) => string;
}

/**
 * Establish that a rendezvous directory is one only this user can enter.
 *
 * Checked BEFORE a socket is created in it, because the guarantee is what makes the socket
 * meaningful — binding first and validating after would leave a window in which a reachable socket
 * exists with nothing yet established about who can reach it.
 */
export function admitLocalPeerDirectory(
  directory: string,
  options: IGuardedDirectoryOptions,
): ILocalPeerAdmission {
  const stat = options.statAt ?? ((target: string): IStatLike => lstatSync(target));
  const resolve = options.resolve ?? ((target: string): string => realpathSync(target));

  let resolved: string;
  try {
    resolved = resolve(directory);
  } catch {
    // allow-fallback: this does not substitute an alternative path — it converts an unresolvable
    // directory into a REFUSAL. The terminal failure stays terminal; the failure IS the verdict.
    return refuseLocalPeer(
      `the rendezvous directory ${directory} could not be resolved. An unresolvable path is a ` +
        'refusal, never a pass — this mechanism exists because absence of evidence was being read ' +
        'as evidence.',
    );
  }

  let info: IStatLike;
  try {
    info = stat(resolved);
  } catch {
    // allow-fallback: an uninspectable directory becomes a REFUSAL, never a permitted alternative.
    // A guard that cannot read what it guards must not admit.
    return refuseLocalPeer(`the rendezvous directory ${resolved} could not be inspected.`);
  }

  // Checked on the RESOLVED path deliberately: resolving first and rejecting a link second means a
  // link cannot be swapped in between the two reads.
  if (info.isSymbolicLink()) {
    return refuseLocalPeer(
      `${resolved} is a symbolic link. The guarantee is about the directory the kernel enforces ` +
        'permissions on, and a link can be repointed after it is checked.',
    );
  }
  if (!info.isDirectory()) {
    return refuseLocalPeer(`${resolved} is not a directory, so it cannot guard a rendezvous.`);
  }
  if (info.uid !== options.expectedUid) {
    return refuseLocalPeer(
      `the rendezvous directory ${resolved} belongs to uid ${info.uid}, not ` +
        `${options.expectedUid}. A directory this user does not own is not this user's boundary.`,
    );
  }
  if ((info.mode & GROUP_OR_OTHER) !== 0) {
    return refuseLocalPeer(
      `the rendezvous directory ${resolved} is mode ${(info.mode & 0o777).toString(8)}, which ` +
        'grants group or other access. The whole proof is that no other account can traverse it.',
    );
  }

  return {
    admitted: true,
    trust: 'same-user-same-host',
    binding: { socketPath: '', guardedDirectory: resolved, ownerUid: info.uid },
  };
}

/**
 * Admit a rendezvous socket: the guarded directory, plus the socket path resolving INSIDE it.
 *
 * The containment check is not redundant with the directory check. Without it a caller could pass a
 * validated directory and a socket path somewhere else entirely, and the result would assert a
 * guarantee that applies to a different file.
 */
export function admitLocalPeerSocket(
  socketPath: string,
  options: IGuardedDirectoryOptions,
): ILocalPeerAdmission {
  const admission = admitLocalPeerDirectory(path.dirname(socketPath), options);
  if (!admission.admitted || admission.binding === undefined) return admission;

  const resolve = options.resolve ?? ((target: string): string => realpathSync(target));
  const guarded = admission.binding.guardedDirectory;
  let resolvedSocket: string;
  try {
    resolvedSocket = resolve(socketPath);
  } catch {
    // allow-fallback: the socket not existing YET is the ordinary state at bind time, and the
    // guarantee is carried by the DIRECTORY rather than by the file. The computed path is still
    // containment-checked below, so this widens nothing that gets admitted.
    resolvedSocket = path.join(guarded, path.basename(socketPath));
  }

  const inside = resolvedSocket === guarded || resolvedSocket.startsWith(`${guarded}${path.sep}`);
  if (!inside) {
    return refuseLocalPeer(
      `${resolvedSocket} resolves outside the guarded directory ${guarded}, so that directory's ` +
        'permissions say nothing about it.',
    );
  }

  return {
    admitted: true,
    trust: 'same-user-same-host',
    binding: { ...admission.binding, socketPath: resolvedSocket },
  };
}
