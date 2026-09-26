/**
 * What a turn driven by ANOTHER agent session may do — one more input to the one evaluator.
 *
 * A peer's message is untrusted input, and a peer turn never has more authority than an operator
 * turn. So this is not a second gate: `evaluatePermission` asks it right after the deny list and the
 * caller's ceiling, and what it lets through is then decided exactly like the operator's own call.
 * It only narrows:
 *
 * - a peer on another host uses no tool;
 * - a peer on the same host may use a read that reaches nothing but the workspace — every location
 *   it names resolves inside, symlinks followed, and none of them is a secret. Writing and executing
 *   are refused unless the operator enabled them, and then every use asks;
 * - the reply to the peer exists only in a peer turn. Within one it is not this step's to decide: it
 *   sends text off this machine, so the ordinary steps decide it like any such call — rules, mode
 *   and remembered consent.
 *
 * Where the peer runs comes from admission, never from anything the peer sent.
 */

import type { TToolRiskClass } from './permission-mode.js';
import type { TResolveInWorkspace } from './read-only-commands.js';

/** The part of a tool's declared permission profile the peer step reads. */
export interface IPeerTurnToolProfile {
  readonly riskClass?: TToolRiskClass;
  readonly workspacePaths?: readonly string[];
  readonly repliesToPeer?: boolean;
}

/** Where a peer runs relative to this session, as admission established it. */
export type TPeerReach = 'same-host' | 'another-host';

/** The peer-turn input to the permission evaluator. Absent means the operator's own turn. */
export interface IPeerTurnAuthority {
  readonly reach: TPeerReach;
  /** The operator enabled write and execute tools for same-host peer turns; each use still asks. */
  readonly allowChanges: boolean;
}

/** What the peer step decided: refuse, ask, or leave the call to the ordinary steps. */
export type TPeerTurnVerdict = 'deny' | 'ask' | 'continue';

/** Directories that hold credentials wherever they sit. */
const SECRET_DIRECTORY_NAMES = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.azure',
  '.kube',
  '.password-store',
]);
/** Files that hold credentials wherever they sit. */
const SECRET_FILE_NAMES = new Set([
  '.netrc',
  '.git-credentials',
  '.pgpass',
  '.npmrc',
  '.pypirc',
  '.htpasswd',
]);
const SECRET_FILE_PATTERNS = [
  /^\.env/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
];
/** Credential stores under the user's home directory. */
const HOME_SECRET_PREFIXES = [
  ['.robota'],
  ['.docker'],
  ['.config', 'gcloud'],
  ['.config', 'gh'],
  ['Library', 'Keychains'],
];

function segmentsOf(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}

function startsWithSegments(segments: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((segment, index) => segments[index] === segment);
}

/**
 * Whether a path names a credential: a secret directory or anything in it, a secret file, or a
 * credential store under the home directory. Judged on the text, so a caller checks both the path
 * as written and where it really resolves.
 */
export function isSecretPath(path: string, homeDirectory?: string): boolean {
  const segments = segmentsOf(path.replace(/^~(?=\/|$)/, homeDirectory ?? '~'));
  if (segments.some((segment) => SECRET_DIRECTORY_NAMES.has(segment))) return true;
  const name = segments[segments.length - 1] ?? '';
  // A glob's last segment may be the pattern itself (`.env*`), which is still about a secret.
  if (SECRET_FILE_NAMES.has(name) || SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name))) {
    return true;
  }
  if (homeDirectory === undefined) return false;
  const homeSegments = segmentsOf(homeDirectory);
  const underHome = path.startsWith('~')
    ? segments.slice(1)
    : startsWithSegments(segments, homeSegments)
      ? segments.slice(homeSegments.length)
      : undefined;
  return (
    underHome !== undefined &&
    HOME_SECRET_PREFIXES.some((prefix) => startsWithSegments(underHome, prefix))
  );
}

export interface IPeerTurnWhere {
  readonly homeDirectory?: string;
  readonly resolveInWorkspace?: TResolveInWorkspace;
}

/** Every location the call names resolves inside the workspace and is not a secret. */
function staysInWorkspace(
  names: readonly string[],
  args: Readonly<Record<string, unknown>>,
  where: IPeerTurnWhere,
): boolean {
  for (const name of names) {
    const value = args[name];
    if (value === undefined) continue;
    if (typeof value !== 'string') return false;
    if (isSecretPath(value, where.homeDirectory)) return false;
    // Without a filesystem to ask, where the path lands cannot be known, and unknown is not inside.
    const real = where.resolveInWorkspace?.(undefined, value);
    if (real === undefined || isSecretPath(real, where.homeDirectory)) return false;
  }
  return true;
}

/** The peer step of the evaluation, for any tool but the reply. */
export function decidePeerTurnCall(
  profile: IPeerTurnToolProfile | undefined,
  args: Readonly<Record<string, unknown>>,
  authority: IPeerTurnAuthority,
  where: IPeerTurnWhere,
): TPeerTurnVerdict {
  if (authority.reach !== 'same-host') return 'deny';
  // The DECLARED class, not one narrowed for this call: a shell running `cat` is still a shell.
  const riskClass = profile?.riskClass;
  if (riskClass === 'inspect' && profile?.workspacePaths !== undefined) {
    return staysInWorkspace(profile.workspacePaths, args, where) ? 'continue' : 'deny';
  }
  if ((riskClass === 'modify' || riskClass === 'execute') && authority.allowChanges) return 'ask';
  return 'deny';
}

/** Whether a peer turn is shown this tool at all — a tool it could never use is not offered. */
export function isAvailableInPeerTurn(
  profile: IPeerTurnToolProfile | undefined,
  authority: IPeerTurnAuthority,
): boolean {
  if (profile?.repliesToPeer === true) return true;
  if (authority.reach !== 'same-host') return false;
  if (profile?.riskClass === 'inspect') return profile.workspacePaths !== undefined;
  return (
    (profile?.riskClass === 'modify' || profile?.riskClass === 'execute') && authority.allowChanges
  );
}
