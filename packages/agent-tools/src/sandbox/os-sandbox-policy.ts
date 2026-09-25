/**
 * What an OS-level sandbox lets a command touch, written once per backend (issue #3082).
 *
 * The same policy becomes bubblewrap arguments on Linux and a Seatbelt profile on macOS:
 * - the whole filesystem is readable except the `denyRead` paths;
 * - writes are allowed only inside the workspace, the temporary directories and `allowWrite`;
 * - inside the workspace, the files that configure git, the agent, MCP servers and shells stay
 *   read-only, so a confined command cannot change what the next session trusts;
 * - the network is either reachable or not. There is no per-domain allowlist: that needs a proxy
 *   process the OS cannot enforce, and a boundary here is only worth what the OS enforces.
 */

import { PROTECTED_DIRECTORY_NAMES, PROTECTED_FILE_NAMES } from '@robota-sdk/agent-core';

export interface IOsSandboxPolicy {
  /** The workspace root, real path. Writable. */
  readonly root: string;
  /** Temporary directories, real paths. Writable. */
  readonly tempDirectories: readonly string[];
  /** Further writable paths, absolute. */
  readonly allowWrite: readonly string[];
  /** Paths hidden from the command, absolute, with whether each is a directory. */
  readonly denyRead: readonly { readonly path: string; readonly directory: boolean }[];
  readonly network: boolean;
}

/** An isolated worktree's files are ordinary workspace files. */
const WRITABLE_INSIDE_PROTECTED = ['.robota/worktrees', '.claude/worktrees'];

function join(root: string, relative: string): string {
  return `${root.replace(/\/+$/, '')}/${relative}`;
}

/**
 * Workspace entries a confined command must not write, relative to the root. `.git` is read-only
 * as a whole: the files that make git run something (config, hooks, `commondir`, per-worktree
 * config) are too many and too easy to add to for a list inside it to stay complete, so git
 * commands that write run unconfined, through the ordinary permission path.
 */
export function protectedWorkspaceEntries(): readonly string[] {
  return [...PROTECTED_DIRECTORY_NAMES, ...PROTECTED_FILE_NAMES];
}

export interface IBubblewrapInput {
  readonly policy: IOsSandboxPolicy;
  /** Which of `protectedWorkspaceEntries()` and the writable worktree folders exist. */
  readonly exists: (path: string) => boolean;
  /** Entry names in a directory, for the worktrees whose `.git` file must stay put. */
  readonly listDirectory: (path: string) => readonly string[];
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
  /**
   * The descriptor `bwrap --seccomp` reads the Unix-socket filter from. Required when the network
   * is off: without it a daemon's socket is still reachable.
   */
  readonly seccompDescriptor?: number;
}

/** The `bwrap` argument vector that runs `command args` under the policy. */
export function bubblewrapArguments(input: IBubblewrapInput): string[] {
  const { policy } = input;
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc'];
  for (const path of [policy.root, ...policy.tempDirectories, ...policy.allowWrite]) {
    args.push('--bind-try', path, path);
  }
  // A bind over a path that does not exist would create it on the host, so only existing entries
  // are mounted read-only; the client moves aside one a command creates (see the client).
  for (const entry of protectedWorkspaceEntries()) {
    const path = join(policy.root, entry);
    if (input.exists(path)) args.push('--ro-bind', path, path);
  }
  for (const entry of WRITABLE_INSIDE_PROTECTED) {
    const path = join(policy.root, entry);
    if (!input.exists(path)) continue;
    args.push('--bind', path, path);
    // A worktree's `.git` file says where its repository is; it stays read-only too.
    for (const name of input.listDirectory(path)) {
      const gitFile = join(path, `${name}/.git`);
      if (input.exists(gitFile)) args.push('--ro-bind', gitFile, gitFile);
    }
  }
  for (const hidden of policy.denyRead) {
    if (!input.exists(hidden.path)) continue;
    if (hidden.directory) args.push('--tmpfs', hidden.path);
    else args.push('--ro-bind', '/dev/null', hidden.path);
  }
  if (!policy.network) {
    if (input.seccompDescriptor === undefined) {
      throw new Error('A sandbox without network needs the Unix-socket seccomp filter.');
    }
    args.push('--unshare-net', '--seccomp', String(input.seccompDescriptor));
  }
  // Its own process namespace: a confined command cannot signal or trace the host's processes.
  args.push('--unshare-pid', '--die-with-parent', '--new-session', '--chdir', input.cwd);
  args.push('--', input.command);
  return [...args, ...input.args];
}

function regexEscape(path: string): string {
  return path.replace(/[\\^$.*+?()[\]{}|"]/g, (char) => `\\${char}`);
}

function quote(path: string): string {
  return `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The Seatbelt profile for `sandbox-exec -p`. Later rules win, so the order below is the policy:
 * deny writes, allow the writable places, deny the protected entries again, reopen worktrees.
 */
export function seatbeltProfile(policy: IOsSandboxPolicy): string {
  const writable = [policy.root, ...policy.tempDirectories, ...policy.allowWrite]
    .map((path) => `(subpath ${quote(path)})`)
    .join(' ');
  const protectedEntries = protectedWorkspaceEntries().map((entry) => {
    const path = join(policy.root, entry);
    return PROTECTED_FILE_NAMES.includes(entry)
      ? `(literal ${quote(path)})`
      : `(subpath ${quote(path)})`;
  });
  const worktrees = WRITABLE_INSIDE_PROTECTED.map(
    (entry) => `(subpath ${quote(join(policy.root, entry))})`,
  );
  // `.git` itself cannot be renamed or replaced, and neither can a worktree's `.git` file.
  const pinned = [
    `(literal ${quote(join(policy.root, '.git'))})`,
    ...WRITABLE_INSIDE_PROTECTED.map(
      (entry) => `(regex #"^${regexEscape(join(policy.root, entry))}/[^/]+/\\.git$")`,
    ),
  ];
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${writable} (literal "/dev/null") (regex #"^/dev/tty") (regex #"^/dev/fd/"))`,
    `(deny file-write* ${protectedEntries.join(' ')})`,
    `(allow file-write* ${worktrees.join(' ')})`,
    `(deny file-write* ${pinned.join(' ')})`,
  ];
  if (policy.denyRead.length > 0) {
    const hidden = policy.denyRead.map((entry) =>
      entry.directory ? `(subpath ${quote(entry.path)})` : `(literal ${quote(entry.path)})`,
    );
    lines.push(`(deny file-read* ${hidden.join(' ')})`);
  }
  if (!policy.network) lines.push('(deny network*)');
  return lines.join('\n');
}
