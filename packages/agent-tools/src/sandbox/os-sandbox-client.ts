/**
 * OS-level confinement of shell commands over the host filesystem (issue #3082): bubblewrap on
 * Linux and WSL2, Seatbelt (`sandbox-exec`) on macOS. Other platforms have no backend; the client
 * reports that instead of pretending.
 *
 * It is a `shared` sandbox client: file tools stay on the host under the path guard, and the shell
 * tool starts the wrapped invocation itself. Settings are live — `/sandbox` changes them for the
 * next command without rebuilding the session.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, resolve } from 'node:path';

import { resolvePlatformShell, splitCommandSegments } from '@robota-sdk/agent-core';

import {
  bubblewrapArguments,
  protectedWorkspaceEntries,
  seatbeltProfile,
} from './os-sandbox-policy.js';
import { unixSocketSeccompFilter } from './os-sandbox-seccomp.js';

import type { IOsSandboxPolicy } from './os-sandbox-policy.js';
import type {
  ICommandInvocation,
  ISandboxClient,
  ISandboxRunOptions,
  ISandboxRunResult,
} from './types.js';

export type TOsSandboxBackend = 'bubblewrap' | 'seatbelt';

export interface IOsSandboxSettings {
  /** Confine shell commands. */
  readonly enabled: boolean;
  /** A confined command runs without a prompt; deny and ask rules still apply first. */
  readonly autoAllowBashIfSandboxed: boolean;
  /** Commands (first word) that run unconfined and take the ordinary permission path. */
  readonly excludedCommands: readonly string[];
  /** Further writable paths: absolute, `~/`-relative, or relative to the workspace. */
  readonly allowWrite: readonly string[];
  /** Paths hidden from confined commands, written the same way. */
  readonly denyRead: readonly string[];
  /** Whether confined commands may reach the network. */
  readonly network: boolean;
}

export const DEFAULT_OS_SANDBOX_SETTINGS: IOsSandboxSettings = Object.freeze({
  enabled: false,
  autoAllowBashIfSandboxed: true,
  excludedCommands: [],
  allowWrite: [],
  denyRead: [],
  network: false,
});

/** What this machine can do, found once at startup. */
export interface IOsSandboxAvailability {
  readonly backend?: TOsSandboxBackend;
  /** The backend's executable, when found and working. */
  readonly executable?: string;
  /** What to install or fix, when the platform has a backend but it cannot run. */
  readonly missing: readonly string[];
  /** Set when the platform has no backend at all. */
  readonly unsupportedPlatform?: string;
}

export interface IDetectOsSandboxOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  /** Test seam; production runs the probe with `spawnSync`. */
  readonly probe?: (command: string, args: readonly string[]) => { ok: boolean; detail?: string };
}

const SEATBELT_EXECUTABLE = '/usr/bin/sandbox-exec';

function defaultProbe(command: string, args: readonly string[]): { ok: boolean; detail?: string } {
  const result = spawnSync(command, [...args], { timeout: 5_000, encoding: 'utf8' });
  if (result.error !== undefined) return { ok: false, detail: result.error.message };
  const detail = (result.stderr ?? '').trim().split('\n')[0];
  return result.status === 0 ? { ok: true } : { ok: false, ...(detail ? { detail } : {}) };
}

/** Find the platform's backend and check it can actually start a sandbox here. */
export function detectOsSandbox(options: IDetectOsSandboxOptions = {}): IOsSandboxAvailability {
  const platform = options.platform ?? process.platform;
  const probe = options.probe ?? defaultProbe;
  if (platform === 'linux') {
    if (unixSocketSeccompFilter(options.arch ?? process.arch) === undefined) {
      return {
        backend: 'bubblewrap',
        missing: [
          `a seccomp filter for ${options.arch ?? process.arch} (x64 and arm64 are supported)`,
        ],
      };
    }
    const check = probe('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', 'true']);
    if (check.ok) return { backend: 'bubblewrap', executable: 'bwrap', missing: [] };
    const reason = check.detail?.includes('ENOENT')
      ? 'bubblewrap (install the `bubblewrap` package)'
      : `bubblewrap cannot create a sandbox here${check.detail ? `: ${check.detail}` : ''}`;
    return { backend: 'bubblewrap', missing: [reason] };
  }
  if (platform === 'darwin') {
    const check = probe(SEATBELT_EXECUTABLE, ['-p', '(version 1)(allow default)', '/usr/bin/true']);
    if (check.ok) return { backend: 'seatbelt', executable: SEATBELT_EXECUTABLE, missing: [] };
    return {
      backend: 'seatbelt',
      missing: [`sandbox-exec cannot run${check.detail ? `: ${check.detail}` : ''}`],
    };
  }
  return { missing: [], unsupportedPlatform: platform };
}

export interface IOsSandboxClientOptions {
  /** The workspace root. */
  readonly root: string;
  readonly availability: IOsSandboxAvailability;
  readonly settings?: Partial<IOsSandboxSettings>;
  readonly homeDirectory?: string;
}

export interface IOsSandboxStatus {
  readonly settings: IOsSandboxSettings;
  readonly availability: IOsSandboxAvailability;
  /** Settings ask for confinement and the backend can provide it. */
  readonly active: boolean;
}

function realPathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

type IProtectedEntryState =
  | { readonly path: string; readonly kind: 'missing' | 'present' }
  | { readonly path: string; readonly kind: 'symlink'; readonly target: string };

/** The program a shell line starts first — what `excludedCommands` names. */
function firstProgram(shellCommand: string): string | undefined {
  return shellCommand.trim().split(/\s+/)[0];
}

export class OsSandboxClient implements ISandboxClient {
  readonly filesystem = 'shared' as const;
  private readonly root: string;
  private readonly availability: IOsSandboxAvailability;
  private readonly homeDirectory: string;
  private current: IOsSandboxSettings;

  constructor(options: IOsSandboxClientOptions) {
    this.root = realPathOrSelf(options.root);
    this.availability = options.availability;
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.current = { ...DEFAULT_OS_SANDBOX_SETTINGS, ...options.settings };
  }

  status(): IOsSandboxStatus {
    return {
      settings: this.current,
      availability: this.availability,
      active: this.current.enabled && this.availability.executable !== undefined,
    };
  }

  /** Change the settings for the next command. */
  configure(settings: Partial<IOsSandboxSettings>): void {
    this.current = { ...this.current, ...settings };
  }

  /** Whether `shellCommand` would run confined. */
  confines(shellCommand: string): boolean {
    if (!this.status().active) return false;
    // An exclusion names one program; a line that runs anything else with it stays confined.
    if (splitCommandSegments(shellCommand).length !== 1) return true;
    const program = firstProgram(shellCommand);
    return program === undefined || !this.current.excludedCommands.includes(program);
  }

  autoApproves(shellCommand: string): boolean {
    if (!this.current.autoAllowBashIfSandboxed || !this.confines(shellCommand)) return false;
    // A protected entry that is a symlink is only as read-only as every directory on its target's
    // path: one that dangles, or points back into the writable workspace, can be redirected by the
    // command (create the target, or swap a directory along the way). A person decides instead.
    return !this.protectedEntryStates().some(
      (state) => state.kind === 'symlink' && !this.resolvesOutsideWritableWorkspace(state.path),
    );
  }

  wrapCommand(invocation: ICommandInvocation, shellCommand: string): ICommandInvocation {
    if (!this.confines(shellCommand)) return invocation;
    const policy = this.policy();
    const executable = this.availability.executable!;
    if (this.availability.backend === 'seatbelt') {
      return {
        command: executable,
        args: ['-p', seatbeltProfile(policy), invocation.command, ...invocation.args],
        cwd: invocation.cwd,
      };
    }
    const filter = policy.network ? undefined : unixSocketSeccompFilter();
    // `.robota` is robota's own state directory: made before the command, so it is mounted
    // read-only and nothing the host writes there is caught up in `restoreProtectedEntries`.
    if (
      !this.protectedEntryStates().some(
        (state) => state.path.endsWith('/.robota') && state.kind === 'symlink',
      )
    ) {
      mkdirSync(`${this.root}/.robota`, { recursive: true });
    }
    const before = this.protectedEntryStates();
    return {
      command: executable,
      args: bubblewrapArguments({
        policy,
        // Follows symlinks: a protected link is mounted through to its target, which is what then
        // stays read-only; the link itself is restored after exit if the command replaced it.
        exists: existsSync,
        listDirectory: (path) => readdirSync(path),
        cwd: invocation.cwd,
        command: invocation.command,
        args: invocation.args,
        ...(filter !== undefined ? { seccompDescriptor: 3 } : {}),
      }),
      cwd: invocation.cwd,
      ...(filter !== undefined ? { inputDescriptors: [filter] } : {}),
      afterExit: () => this.restoreProtectedEntries(before),
    };
  }

  /**
   * How each protected entry stands before a command: bubblewrap can mount an existing entry
   * read-only, but not one that does not exist yet, and a symlink it mounts through to its target
   * while the link itself stays replaceable. Read with `lstat`, so a dangling link is not "missing".
   */
  private protectedEntryStates(): IProtectedEntryState[] {
    return protectedWorkspaceEntries().map((entry) => {
      const path = `${this.root}/${entry}`;
      try {
        const stat = lstatSync(path);
        return stat.isSymbolicLink()
          ? { path, kind: 'symlink' as const, target: readlinkSync(path) }
          : { path, kind: 'present' as const };
      } catch {
        return { path, kind: 'missing' as const };
      }
    });
  }

  /**
   * Undo what the command did to protected entries it could reach: one it created where none
   * existed is moved into `.robota/sandbox-quarantine`, and a symlink it replaced is restored. Moved,
   * not deleted, so nothing the host wrote meanwhile is lost.
   */
  /** Whether a path's real location is outside the workspace (and so under the read-only mounts). */
  private resolvesOutsideWritableWorkspace(path: string): boolean {
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      return false;
    }
    return real !== this.root && !real.startsWith(`${this.root}/`);
  }

  /**
   * Never throws: this runs as the command's process closes, and an exception there would take the
   * host down and leave the entry in place. The quarantine is outside the workspace, under the
   * user's `~/.robota`, where the command cannot reach it; what cannot be moved there is removed.
   */
  private restoreProtectedEntries(before: readonly IProtectedEntryState[]): string | undefined {
    const quarantine = `${this.homeDirectory}/.robota/sandbox-quarantine/${Date.now()}`;
    const notes: string[] = [];
    for (const state of before) {
      if (state.kind === 'present') continue;
      try {
        const now = this.protectedEntryStates().find((entry) => entry.path === state.path)!;
        if (state.kind === 'missing' && now.kind === 'missing') continue;
        if (state.kind === 'symlink' && now.kind === 'symlink' && now.target === state.target) {
          continue;
        }
        if (now.kind !== 'missing') notes.push(this.setAside(state.path, quarantine));
        if (state.kind === 'symlink') symlinkSync(state.target, state.path);
      } catch (error) {
        // allow-fallback: reported in the command's output, never thrown into the host
        notes.push(
          `could not restore ${state.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (notes.length === 0) return undefined;
    return (
      `[sandbox] A confined command may not create or replace git, agent, MCP or shell ` +
      `configuration: ${notes.join('; ')}.`
    );
  }

  private setAside(path: string, quarantine: string): string {
    const destination = `${quarantine}/${basename(path)}`;
    try {
      mkdirSync(quarantine, { recursive: true });
      renameSync(path, destination);
      return `moved ${path} to ${destination}`;
    } catch {
      // allow-fallback: another filesystem or a hostile layout; the command's own entry goes
      rmSync(path, { recursive: true, force: true });
      return `removed ${path}`;
    }
  }

  /** The policy for the current settings, with every path made absolute and real. */
  policy(): IOsSandboxPolicy {
    const absolute = (path: string): string => {
      const expanded =
        path === '~' || path.startsWith('~/') ? `${this.homeDirectory}${path.slice(1)}` : path;
      return realPathOrSelf(isAbsolute(expanded) ? expanded : resolve(this.root, expanded));
    };
    const temp = [...new Set([tmpdir(), '/tmp'].filter(existsSync).map(realPathOrSelf))];
    return {
      root: this.root,
      tempDirectories: temp,
      allowWrite: this.current.allowWrite.map(absolute),
      denyRead: this.current.denyRead.map((path) => {
        const resolved = absolute(path);
        return { path: resolved, directory: isDirectory(resolved) };
      }),
      network: this.current.network,
    };
  }

  run(command: string, options: ISandboxRunOptions = {}): Promise<ISandboxRunResult> {
    const shell = resolvePlatformShell();
    const cwd = options.workingDirectory ?? this.root;
    const invocation = this.wrapCommand(
      { command: shell.command, args: shell.commandArgs(command), cwd },
      command,
    );
    return new Promise((resolveRun, reject) => {
      const extra = invocation.inputDescriptors ?? [];
      const child = spawn(invocation.command, [...invocation.args], {
        cwd: invocation.cwd,
        stdio: ['ignore', 'pipe', 'pipe', ...extra.map(() => 'pipe' as const)],
        ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      });
      extra.forEach((data, index) => {
        (child.stdio[index + 3] as NodeJS.WritableStream | null)?.end(Buffer.from(data));
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', reject);
      child.on('close', (code) => {
        const note = invocation.afterExit?.();
        const out = note === undefined ? stdout : `${stdout}\n${note}`;
        resolveRun({ stdout: out, ...(stderr ? { stderr } : {}), exitCode: code ?? 1 });
      });
    });
  }

  readFile(path: string): Promise<string> {
    return Promise.resolve(readFileSync(path, 'utf8'));
  }

  writeFile(path: string, content: string): Promise<void> {
    writeFileSync(path, content, 'utf8');
    return Promise.resolve();
  }
}
