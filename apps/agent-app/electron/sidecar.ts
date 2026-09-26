/**
 * Pure, Electron-free logic of the desktop shell (unit-testable without a display or the electron binary).
 *
 * The Electron main process (`main.ts`) asks the `robota` CLI to start this workspace's daemon — or reuse
 * the live one — and attaches the window to the loopback address the CLI answers with. The daemon is the
 * CLI's to own: it outlives the window. Everything here that does not need the electron runtime lives in
 * this module so it can be tested in a plain Node/vitest environment.
 */

import { join } from 'node:path';

/** Inputs for resolving the sidecar command — injected (not read from electron) so this stays unit-testable. */
export interface IResolveSidecarCommandOptions {
  /** electron `app.isPackaged` — true in a packaged install, false in dev/e2e. */
  readonly isPackaged: boolean;
  /** electron `process.resourcesPath` — where electron-builder `extraResources` land in a packaged app. */
  readonly resourcesPath: string;
  /** `process.platform` — `'win32'` gets the `.exe` suffix. */
  readonly platform: NodeJS.Platform;
  /** Base environment for the dev-override lookup (`$ROBOTA_GUI_SIDECAR_CMD`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolve the `robota` runtime command (GUI-003). In a PACKAGED app the runtime binary is bundled via
 * electron-builder `extraResources` at `<resourcesPath>/robota[.exe]`, so the app is fully self-contained —
 * zero external install. In DEV/e2e, fall back to `$ROBOTA_GUI_SIDECAR_CMD` (the scripted-sidecar double) or
 * PATH `robota`.
 */
export function resolveSidecarCommand(options: IResolveSidecarCommandOptions): string {
  if (options.isPackaged) {
    return join(options.resourcesPath, options.platform === 'win32' ? 'robota.exe' : 'robota');
  }
  return options.env?.['ROBOTA_GUI_SIDECAR_CMD'] ?? 'robota';
}

/** The concrete command/args/env used to run `robota daemon start --json`. */
export interface IDaemonStartSpawn {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Build the `daemon start` invocation. The shell adds nothing to the environment: the CLI mints the
 * daemon's token itself and hands it back on stdout, so no secret travels on argv or through this process's
 * environment.
 */
export function buildDaemonStartSpawn(
  command: string,
  baseEnv: Readonly<Record<string, string | undefined>> = {},
): IDaemonStartSpawn {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (typeof v === 'string') env[k] = v;
  }
  return { command, args: ['daemon', 'start', '--json'], env };
}

/** The daemon the CLI started or reused: its id, the renderer's WS URL (token included), and its port. */
export interface IDaemonEndpoint {
  readonly id: string;
  readonly url: string;
  readonly port: number;
}

/** Loopback only, an explicit port, and a non-empty token — nothing else in the URL. */
const DAEMON_URL = /^ws:\/\/127\.0\.0\.1:([0-9]{1,5})\/?\?token=([A-Za-z0-9%._~-]+)$/;
const MAX_PORT = 65535;

/**
 * Read the one JSON line `robota daemon start --json` prints. Anything that is not exactly that line, or
 * whose URL could point the token-holding renderer anywhere but a loopback port, is refused — the URL also
 * feeds the page's CSP.
 */
export function parseDaemonStartOutput(stdout: string): IDaemonEndpoint | undefined {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length !== 1) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0] ?? '');
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { id, url } = parsed as { id?: unknown; url?: unknown };
  if (typeof id !== 'string' || id.trim() === '' || typeof url !== 'string') return undefined;
  const match = DAEMON_URL.exec(url);
  if (!match) return undefined;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) return undefined;
  return { id, url, port };
}

/**
 * The reason shown on the fatal screen when the daemon could not be started or reused: what the CLI said
 * on stderr (an untrusted workspace names `robota trust`), else a description of the unexpected answer.
 */
export function describeDaemonStartFailure(result: {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
}): string {
  const said = result.stderr.trim();
  if (said) return said;
  if (result.exitCode === 0) {
    const answer = result.stdout.trim();
    return answer
      ? `robota daemon start answered with an unexpected result:\n${answer}`
      : 'robota daemon start exited without reporting the daemon address.';
  }
  return `robota daemon start failed (exit ${result.exitCode ?? 'signal'}).`;
}

/** How much of the CLI's error output the shell keeps: enough for the reason it stopped. */
export const OUTPUT_TAIL_LIMIT = 4000;

/**
 * Append a chunk of CLI output, keeping only the tail. The CLI says why it will not start (an untrusted
 * workspace names `robota trust`, a missing key names the setup) on stderr, and the fatal screen shows that
 * tail instead of a bare "stopped".
 */
export function appendOutputTail(tail: string, chunk: string): string {
  const next = tail + chunk;
  return next.length > OUTPUT_TAIL_LIMIT ? next.slice(next.length - OUTPUT_TAIL_LIMIT) : next;
}

/** The lifecycle state the renderer renders (reusing agent-ui-web's `status` surface for the fatal case). */
export type TSidecarState = 'starting' | 'ready' | 'fatal';
