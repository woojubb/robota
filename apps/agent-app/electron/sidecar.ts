/**
 * GUI-002 — pure, Electron-free sidecar logic (unit-testable without a display or the electron binary).
 *
 * The Electron main process (`main.ts`) mints a per-launch loopback endpoint, spawns the `robota` CLI as a
 * sidecar with the token+port in its environment, and supervises the child. All the logic that does NOT need
 * the electron runtime lives here so it can be tested in a plain Node/vitest environment (TC-04).
 */

import { randomBytes } from 'node:crypto';

/** Auth-token entropy: 256 bits (32 bytes), hex-encoded. */
const TOKEN_BYTES = 32;

/** A per-launch loopback endpoint: the free port the sidecar binds + the auth token it must enforce. */
export interface ISidecarEndpoint {
  readonly port: number;
  readonly token: string;
}

/** The loopback WS URL the renderer connects to — the token rides as a query param (browsers can't set headers). */
export function endpointUrl(endpoint: ISidecarEndpoint): string {
  return `ws://127.0.0.1:${endpoint.port}?token=${encodeURIComponent(endpoint.token)}`;
}

/** Mint the auth token (256-bit, crypto-grade). The port is supplied by the caller (found free via `net`). */
export function mintToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/** The concrete command/args/env used to spawn the `robota` sidecar for a given endpoint. */
export interface ISidecarSpawn {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface IBuildSidecarSpawnOptions {
  /** Override the sidecar command (default `robota`, or `$ROBOTA_GUI_SIDECAR_CMD`). Later: the bundled binary. */
  readonly command?: string;
  /** Extra CLI args appended after the defaults. */
  readonly extraArgs?: readonly string[];
  /** Base environment to extend (defaults to an empty object in tests; `process.env` in main). */
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
}

/**
 * Build the sidecar spawn descriptor: the `robota` CLI, carrying the endpoint as `ROBOTA_WS_TOKEN` +
 * `ROBOTA_WS_PORT` env (which `agent-cli` reads to enforce the loopback auth — GUI-002 T5). The token is
 * NEVER placed on the argv (argv is world-readable via `ps`); it travels in the child env only.
 */
export function buildSidecarSpawn(
  endpoint: ISidecarEndpoint,
  options: IBuildSidecarSpawnOptions = {},
): ISidecarSpawn {
  const command = options.command ?? 'robota';
  const baseEnv = options.baseEnv ?? {};
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (typeof v === 'string') env[k] = v;
  }
  env['ROBOTA_WS_TOKEN'] = endpoint.token;
  env['ROBOTA_WS_PORT'] = String(endpoint.port);
  return {
    command,
    args: [...(options.extraArgs ?? [])],
    env,
  };
}

/** The lifecycle state the renderer renders (reusing agent-transport-gui's `status` surface for the fatal case). */
export type TSidecarState = 'starting' | 'ready' | 'fatal';

/** Minimal child handle the supervisor drives — satisfied by a `ChildProcess` and by a test stub. */
export interface ISupervisedChild {
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

/**
 * Supervise the sidecar child: report state transitions, map an unexpected child exit to `fatal`, and drive
 * a graceful shutdown (SIGTERM → SIGKILL backstop) on window close. Electron-free; `main.ts` injects the real
 * spawned child and a timer. Testable with a stub child + fake timers.
 */
export class SidecarSupervisor {
  private state: TSidecarState = 'starting';
  private stopping = false;

  constructor(
    private readonly child: ISupervisedChild,
    private readonly onState: (state: TSidecarState) => void,
    private readonly killGraceMs = 3000,
    private readonly setTimer: (fn: () => void, ms: number) => void = setTimeout,
  ) {
    this.child.on('exit', (code, signal) => this.handleExit(code, signal));
  }

  /** Called once the renderer has connected + the session is live. */
  markReady(): void {
    if (this.stopping || this.state === 'fatal') return;
    this.state = 'ready';
    this.onState('ready');
  }

  /** Current lifecycle state (diagnostics/tests). */
  get currentState(): TSidecarState {
    return this.state;
  }

  /** Graceful shutdown on window-close/quit: SIGTERM (CLI shuts the session down), SIGKILL backstop. */
  shutdown(): void {
    if (this.stopping) return;
    this.stopping = true;
    this.child.kill('SIGTERM');
    this.setTimer(() => this.child.kill('SIGKILL'), this.killGraceMs);
  }

  private handleExit(_code: number | null, _signal: NodeJS.Signals | null): void {
    if (this.stopping) return; // expected exit during shutdown — not fatal
    // An unexpected sidecar exit (crash) surfaces a non-hanging fatal state in the UI.
    this.state = 'fatal';
    this.onState('fatal');
  }
}
