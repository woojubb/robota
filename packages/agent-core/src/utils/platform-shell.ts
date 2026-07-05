/**
 * TERM-008: cross-platform shell resolution (SSOT).
 *
 * Single source of truth for "which shell do we spawn, and how", shared by every shell-running site
 * (the Shell tool, the hook `command` executor, and the interactive drop-to-shell). Resolution is a
 * pure function of `(env, platform)` so every branch is testable without touching the host shell.
 */

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
  return `Host OS: ${platform} (POSIX). Write portable POSIX sh/bash syntax; avoid OS-specific flags.`;
}

function posixShell(command: string, platform: NodeJS.Platform): IPlatformShell {
  const isBash = /(^|\/)bash$/.test(command);
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

function powerShell(command: string): IPlatformShell {
  return {
    command,
    kind: 'powershell',
    platform: 'win32',
    commandArgs: (cmd: string): string[] => ['-NoProfile', '-Command', cmd],
    interactiveArgs: ['-NoProfile'],
    label: 'PowerShell (Windows)',
    syntaxHint:
      'Write PowerShell syntax (not bash): e.g. `Get-ChildItem` not `ls -la`, `$env:VAR` not `$VAR`.',
  };
}

/**
 * Resolve the shell to spawn for the current (or a given) platform.
 *
 * - `ROBOTA_SHELL` (if set) wins on every platform.
 * - **win32:** PowerShell.
 * - **posix:** `$SHELL` if set, else `/bin/sh`.
 *
 * @param env - Environment to read overrides from. Defaults to `process.env`.
 * @param platform - Platform to resolve for. Defaults to `process.platform`. Pass explicitly in tests.
 */
export function resolvePlatformShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): IPlatformShell {
  const override = env[SHELL_OVERRIDE_ENV]?.trim();

  if (platform === 'win32') {
    if (override !== undefined && override.length > 0) {
      // An override on Windows is assumed PowerShell-compatible unless it is clearly cmd.
      return /(^|\\)cmd(\.exe)?$/i.test(override)
        ? {
            command: override,
            kind: 'cmd',
            platform,
            commandArgs: (cmd: string): string[] => ['/d', '/s', '/c', cmd],
            interactiveArgs: [],
            label: 'cmd.exe (Windows)',
            syntaxHint: 'Write Windows cmd.exe syntax (not bash).',
          }
        : powerShell(override);
    }
    return powerShell('powershell.exe');
  }

  if (override !== undefined && override.length > 0) {
    return posixShell(override, platform);
  }
  const fromEnv = env['SHELL']?.trim();
  return posixShell(fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : '/bin/sh', platform);
}
