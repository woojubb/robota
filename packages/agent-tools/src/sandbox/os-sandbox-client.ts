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
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import {
  isProtectedPath,
  resolvePlatformShell,
  splitCommandSegments,
} from '@robota-sdk/agent-core';

import { bubblewrapArguments, seatbeltProfile } from './os-sandbox-policy.js';

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
    const check = probe('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', 'true']);
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
    const program = firstProgram(shellCommand);
    return program === undefined || !this.current.excludedCommands.includes(program);
  }

  autoApproves(shellCommand: string): boolean {
    if (!this.current.autoAllowBashIfSandboxed || !this.confines(shellCommand)) return false;
    // A protected file that does not exist yet cannot be mounted read-only by bubblewrap; a line
    // naming one takes the ordinary path, so a person sees it.
    return !splitCommandSegments(shellCommand).some((segment) =>
      segment.split(/[\s<>|;&=]+/).some((word) => word !== '' && isProtectedPath(word)),
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
    return {
      command: executable,
      args: bubblewrapArguments({
        policy,
        exists: existsSync,
        cwd: invocation.cwd,
        command: invocation.command,
        args: invocation.args,
      }),
      cwd: invocation.cwd,
    };
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
      const child = spawn(invocation.command, [...invocation.args], {
        cwd: invocation.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', reject);
      child.on('close', (code) =>
        resolveRun({ stdout, ...(stderr ? { stderr } : {}), exitCode: code ?? 1 }),
      );
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
