/**
 * Pure, Electron-free logic of the desktop shell (unit-testable without a display or the electron binary).
 *
 * The Electron main process (`main.ts`) asks the configured CLI to start this workspace's daemon — or reuse
 * the live one — and attaches the window to the loopback address the CLI answers with. The daemon is the
 * CLI's to own: it outlives the window. Everything here that does not need the electron runtime lives in
 * this module so it can be tested in a plain Node/vitest environment.
 */

import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { IEmbeddedProductIdentity } from '@robota-sdk/product-config';

/** Inputs for resolving the sidecar command — injected (not read from electron) so this stays unit-testable. */
export interface IResolveSidecarCommandOptions {
  /** electron `app.isPackaged` — true in a packaged install, false in dev/e2e. */
  readonly isPackaged: boolean;
  /** electron `process.resourcesPath` — where electron-builder `extraResources` land in a packaged app. */
  readonly resourcesPath: string;
  /** `process.platform` — `'win32'` gets the `.exe` suffix. */
  readonly platform: NodeJS.Platform;
  readonly productIdentity: IEmbeddedProductIdentity;
  /** Base environment for the dev-override lookup (`PRODUCT_GUI_SIDECAR_CMD`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolve the product CLI command (GUI-003). In a PACKAGED app its runtime binary is bundled at
 * `<resourcesPath>/<desktopExecutableName>[.exe]`. In DEV/e2e, use the explicit test override or the
 * configured CLI executable on PATH.
 */
export function resolveSidecarCommand(options: IResolveSidecarCommandOptions): string {
  if (options.isPackaged) {
    return join(
      options.resourcesPath,
      `${options.productIdentity.identity.desktopExecutableName}${options.platform === 'win32' ? '.exe' : ''}`,
    );
  }
  return options.env?.['PRODUCT_GUI_SIDECAR_CMD'] ?? options.productIdentity.identity.cliName;
}

/** The concrete command/args/env used to run the CLI daemon start command. */
export interface IDaemonStartSpawn {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Build the `daemon start` invocation. The shell adds nothing to the environment: the CLI mints the
 * daemon's token itself and hands it back on stdout, so no secret travels on argv or through this process's
 * environment. `restricted` is the person's answer to the trust question: run the folder without its own
 * configuration.
 */
export function buildDaemonStartSpawn(
  command: string,
  baseEnv: Readonly<Record<string, string | undefined>> = {},
  options: { readonly restricted?: boolean } = {},
): IDaemonStartSpawn {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (typeof v === 'string') env[k] = v;
  }
  const args = [
    'daemon',
    'start',
    '--json',
    ...(options.restricted === true ? ['--restricted-workspace'] : []),
  ];
  return { command, args, env };
}

/**
 * One file the person chose from the native "Attach files" dialog (#3282 §4d), with its real size —
 * the composer refuses a file over its per-file limit, and needs the size to know that without a
 * round trip to read the file itself.
 */
export interface IPickedFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
}

/**
 * Shape the dialog's chosen paths into `IPickedFile`s. `statSize` is injected (not `node:fs` read
 * directly) so this stays testable without touching a real filesystem — `main.ts` passes
 * `(path) => statSync(path).size`. A path whose size cannot be read (removed between the dialog
 * closing and this running, or an unreadable device file) is left out rather than thrown: the person
 * just sees one fewer chip, not a picker that crashed.
 */
export function buildPickedFiles(
  paths: readonly string[],
  statSize: (path: string) => number | undefined,
): IPickedFile[] {
  const files: IPickedFile[] = [];
  for (const path of paths) {
    const size = statSize(path);
    if (size === undefined) continue;
    files.push({ path, name: basename(path), size });
  }
  return files;
}

/**
 * #3282 §4c — the Project panel's Memory "Open in editor": resolve a workspace-relative (or absolute)
 * path against `cwd` and refuse one that lands outside it, `undefined` for a refusal. `path` comes
 * from the SAME local daemon this window attached to (never a remote/untrusted source), so a lexical
 * `resolve`/`startsWith` check — not the full symlink-following canonicalization a server exposed to
 * other processes needs — is proportionate here.
 */
export function resolveOpenPathTarget(cwd: string, path: string): string | undefined {
  if (path.length === 0) return undefined;
  const absolute = resolve(cwd, path);
  const rel = relative(cwd, absolute);
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  return outside ? undefined : absolute;
}

/** What the window asks before a daemon starts in a folder not trusted yet (issue #3268). */
export interface ITrustQuestion {
  /** The workspace a grant would cover. */
  readonly folder: string;
  /** The project sources trust would load, one row each. */
  readonly loads: readonly string[];
}

/** The person's answer: trust the folder and start, start it Restricted, or quit the app. */
export type TTrustChoice = 'trust' | 'restricted' | 'quit';

export function isTrustChoice(value: unknown): value is TTrustChoice {
  return value === 'trust' || value === 'restricted' || value === 'quit';
}

/** How many source rows the question carries; the rest are counted, not listed. */
const MAX_TRUST_LOADS = 64;

/**
 * Read the CLI trust status JSON. A question comes back only when the CLI says a person can be asked
 * (the folder is not trusted and a grant could change that); anything else — trusted, not a Git
 * repository, an answer that is not that one line — asks nothing, and the daemon start decides.
 */
export function parseTrustStatusOutput(stdout: string): ITrustQuestion | undefined {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length !== 1) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0] ?? '');
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { askable, workspace, loads } = parsed as {
    askable?: unknown;
    workspace?: unknown;
    loads?: unknown;
  };
  if (askable !== true || typeof workspace !== 'string' || workspace.trim() === '')
    return undefined;
  const rows = Array.isArray(loads)
    ? loads.filter((row): row is string => typeof row === 'string')
    : [];
  const shown = rows.slice(0, MAX_TRUST_LOADS);
  return {
    folder: workspace,
    loads:
      rows.length > shown.length ? [...shown, `  … ${rows.length - shown.length} more`] : shown,
  };
}

/** Environment variable names the trusted CLI identified for provider/transport use; values are never serialized. */
export function parseTrustedProviderEnvironmentReferences(stdout: string): readonly string[] | undefined {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length !== 1) return undefined;
  try {
    const parsed: unknown = JSON.parse(lines[0] ?? '');
    if (typeof parsed !== 'object' || parsed === null || (parsed as { state?: unknown }).state !== 'trusted') {
      return undefined;
    }
    const refs = (parsed as { providerEnvRefs?: unknown }).providerEnvRefs;
    if (refs === undefined) return Object.freeze([]);
    if (!Array.isArray(refs) || refs.length > 128) return undefined;
    const valid = refs.filter((name): name is string =>
      typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name),
    );
    return Object.freeze([...new Set(valid)]);
  } catch {
    return undefined;
  }
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
 * Read the one JSON line the CLI daemon start command prints. Anything that is not exactly that line, or
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
 * on stderr (an untrusted workspace names its trust command), else a description of the unexpected answer.
 */
export function describeDaemonStartFailure(result: {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
}, cliName: string): string {
  const said = result.stderr.trim();
  if (said) return said;
  if (result.exitCode === 0) {
    const answer = result.stdout.trim();
    return answer
      ? `${cliName} daemon start answered with an unexpected result:\n${answer}`
      : `${cliName} daemon start exited without reporting the daemon address.`;
  }
  return `${cliName} daemon start failed (exit ${result.exitCode ?? 'signal'}).`;
}

/** How much of the CLI's error output the shell keeps: enough for the reason it stopped. */
export const OUTPUT_TAIL_LIMIT = 4000;

/**
 * Append a chunk of CLI output, keeping only the tail. The CLI says why it will not start (an untrusted
 * workspace names its trust command, a missing key names the setup) on stderr, and the fatal screen shows that
 * tail instead of a bare "stopped".
 */
export function appendOutputTail(tail: string, chunk: string): string {
  const next = tail + chunk;
  return next.length > OUTPUT_TAIL_LIMIT ? next.slice(next.length - OUTPUT_TAIL_LIMIT) : next;
}

/** The lifecycle state the renderer renders (reusing agent-ui-web's `status` surface for the fatal case). */
export type TSidecarState = 'starting' | 'ready' | 'fatal';

/** Where the daemon is, or why the shell could not get one. */
export type TDaemonStart = { ok: true; endpoint: IDaemonEndpoint } | { ok: false; detail: string };

/**
 * The window's attachment to the workspace daemon. The daemon can stop while the window is open (a stop
 * command or crash), so the attachment is replaceable: a new start re-asks the CLI, which starts a
 * daemon or reuses the live one, and may answer with a different port.
 */
export interface IDaemonAttachment {
  /** Ask the CLI for a daemon. While a start is already running, answers with that one instead of racing it. */
  start(): Promise<TDaemonStart>;
  /** The latest start's answer (awaited if still running); `null` before the first start. */
  current(): Promise<TDaemonStart> | null;
  /** The port the page may reach: the latest finished start's, or `undefined` when it has none. */
  port(): number | undefined;
}

export function createDaemonAttachment(run: () => Promise<TDaemonStart>): IDaemonAttachment {
  let latest: Promise<TDaemonStart> | null = null;
  let inFlight: Promise<TDaemonStart> | null = null;
  let settledPort: number | undefined;
  return {
    start() {
      if (inFlight) return inFlight;
      const started = run().then((result) => {
        settledPort = result.ok ? result.endpoint.port : undefined;
        inFlight = null;
        return result;
      });
      inFlight = started;
      latest = started;
      return started;
    },
    current: () => latest,
    port: () => settledPort,
  };
}

/**
 * The renderer's CSP: its only reachable socket is the daemon's loopback port — or nothing, when there is
 * no daemon and the page only shows why.
 */
export function buildContentSecurityPolicy(port: number | undefined): string {
  const connectSrc = port === undefined ? `'none'` : `ws://127.0.0.1:${port}`;
  return (
    `default-src 'self'; connect-src ${connectSrc}; img-src 'self' data:; ` +
    `style-src 'self' 'unsafe-inline'; script-src 'self'`
  );
}
