/**
 * TERM-008: cross-platform shell resolution (SSOT).
 *
 * Single source of truth for "which shell do we spawn, and how", shared by every shell-running site.
 * Resolution is a pure function of one request so every branch is testable without the host shell.
 */

import { RobotaError } from './errors.js';

/** Shell family — drives non-interactive arg shape, quoting, and LLM syntax guidance. */
export type TShellKind = 'bash' | 'sh' | 'powershell' | 'cmd';

/** The active shell resolved for a platform, plus the metadata callers need to drive and describe it. */
export interface IPlatformShell {
  /** Executable to spawn (e.g. `/bin/sh`, `powershell.exe`, or `$SHELL`). */
  readonly command: string;
  /** Shell family. */
  readonly kind: TShellKind;
  /** Node platform this was resolved for (`process.platform`). */
  readonly platform: NodeJS.Platform;
  /** Args to run a single command string non-interactively. */
  commandArgs(command: string): string[];
  /** Args for an interactive shell session (drop-to-shell). */
  readonly interactiveArgs: string[];
  /** Human label for the active shell, for tool/UI descriptions (e.g. `PowerShell (Windows)`). */
  readonly label: string;
  /** One-line syntax guidance for an LLM authoring commands. */
  readonly syntaxHint: string;
}

/** Pure inputs for resolving one executable together with its command argument family. */
export interface IPlatformShellResolutionRequest {
  /** Request-local executable. A non-blank value has the highest precedence. */
  readonly executable?: string;
  /** Environment used for ROBOTA_SHELL and SHELL resolution. */
  readonly env?: NodeJS.ProcessEnv;
  /** Actual host platform retained in the resolved metadata. */
  readonly platform?: NodeJS.Platform;
}

/** An explicit executable whose basename has no supported command argument family. */
export class UnsupportedShellError extends RobotaError {
  readonly code = 'UNSUPPORTED_SHELL';
  readonly category = 'user' as const;
  readonly recoverable = false;

  constructor(public readonly executable: string) {
    super(`Unsupported shell executable: ${executable}`, { executable });
  }
}

/** Explicit override env var — point at any shell executable to force it on any platform. */
const SHELL_OVERRIDE_ENV = 'ROBOTA_SHELL';

/**
 * OS-family syntax guidance for the LLM. macOS and Linux are both POSIX but ship different userlands
 * (macOS = BSD coreutils, most Linux = GNU coreutils), so flags like `sed -i`, `date`, and `grep`
 * differ — naming the OS lets the model avoid Linux-only invocations on macOS and vice versa.
 */
function posixSyntaxHint(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return 'Host OS: macOS (POSIX, BSD userland). Use BSD-flavored utilities: `sed -i ""` needs an empty backup arg, `date`/`grep`/`stat` flags differ from GNU. Prefer portable POSIX flags; avoid Linux/GNU-only options.';
  }
  if (platform === 'linux') {
    return 'Host OS: Linux (POSIX, usually GNU coreutils, but distro/user setup varies). Prefer portable POSIX flags; do not assume a specific distro, and probe with `command -v` before relying on a non-standard tool.';
  }
  return `Host OS: ${platform}; active shell family: POSIX sh/bash. Write portable POSIX syntax and avoid host-specific flags.`;
}

function posixShell(command: string, platform: NodeJS.Platform): IPlatformShell {
  const isBash = shellBasename(command) === 'bash';
  const kind: TShellKind = isBash ? 'bash' : 'sh';
  return {
    command,
    kind,
    platform,
    commandArgs: (cmd: string): string[] => ['-c', cmd],
    interactiveArgs: [],
    label: `${kind} on ${platform}`,
    syntaxHint: posixSyntaxHint(platform),
  };
}

function powerShell(command: string, platform: NodeJS.Platform): IPlatformShell {
  return {
    command,
    kind: 'powershell',
    platform,
    commandArgs: (cmd: string): string[] => ['-NoProfile', '-Command', cmd],
    interactiveArgs: ['-NoProfile'],
    label: `PowerShell on ${platform}`,
    syntaxHint:
      `Host OS: ${platform}; active shell family: PowerShell. Write PowerShell syntax (not bash): e.g. ` +
      '`Get-ChildItem` not `ls -la`, `$env:VAR` not `$VAR`.',
  };
}

function cmdShell(command: string, platform: NodeJS.Platform): IPlatformShell {
  return {
    command,
    kind: 'cmd',
    platform,
    commandArgs: (cmd: string): string[] => ['/d', '/s', '/c', cmd],
    interactiveArgs: [],
    label: `cmd.exe on ${platform}`,
    syntaxHint: `Host OS: ${platform}; active shell family: Windows cmd.exe. Write cmd.exe syntax.`,
  };
}

function shellBasename(command: string): string {
  const basename = command.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
  return basename.replace(/\.exe$/i, '');
}

function explicitShell(command: string, platform: NodeJS.Platform): IPlatformShell {
  switch (shellBasename(command)) {
    case 'sh':
    case 'bash':
      return posixShell(command, platform);
    case 'powershell':
    case 'pwsh':
      return powerShell(command, platform);
    case 'cmd':
      return cmdShell(command, platform);
    default:
      throw new UnsupportedShellError(command);
  }
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Resolve the shell to spawn for the current (or a given) platform.
 *
 * - request `executable` wins when non-blank.
 * - `ROBOTA_SHELL` is next and wins on every platform.
 * - **win32:** PowerShell.
 * - **posix:** `$SHELL` if set, else `/bin/sh`.
 */
export function resolvePlatformShell(
  request: IPlatformShellResolutionRequest = {},
): IPlatformShell {
  const env = request.env ?? process.env;
  const platform = request.platform ?? process.platform;
  const requestedExecutable = nonBlank(request.executable);
  if (requestedExecutable !== undefined) return explicitShell(requestedExecutable, platform);

  const environmentOverride = nonBlank(env[SHELL_OVERRIDE_ENV]);
  if (environmentOverride !== undefined) return explicitShell(environmentOverride, platform);

  if (platform === 'win32') return powerShell('powershell.exe', platform);

  return posixShell(nonBlank(env['SHELL']) ?? '/bin/sh', platform);
}
