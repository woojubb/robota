/**
 * Isolated HOME for PTY children (HARNESS-025).
 *
 * A PTY test that forwards the developer's real `HOME` runs its child against whatever happens to
 * be in that home directory — a `~/.robota` settings file, a shell rc, an `$EDITOR` preference.
 * The suite then passes or fails depending on the machine it runs on: green on CI (empty HOME),
 * red on a developer box whose real config contradicts the fixture. That is the conditional flake
 * this module removes.
 *
 * Every PTY child gets a throwaway directory instead. The directories are tracked and removed on
 * process exit, so a test that forgets to dispose leaks nothing beyond the run.
 *
 * `packages/agent-transport-tui/src/__tests__/pty/pty-driver.ts` already took an explicit
 * `homeDir`; this generalizes that discipline to every `spawnPty` caller, including the default.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const createdHomes: string[] = [];
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', disposeIsolatedHomes);
}

/**
 * Create a throwaway HOME directory for a PTY child and return its absolute path.
 *
 * The directory is empty: the child sees no `~/.robota`, no shell rc, no user preferences. Callers
 * that need seeded content write it themselves after creating the directory.
 */
export function createIsolatedHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'robota-pty-home-'));
  createdHomes.push(dir);
  installExitHook();
  return dir;
}

/** Remove every directory handed out by {@link createIsolatedHome}. Idempotent. */
export function disposeIsolatedHomes(): void {
  for (const dir of createdHomes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Build the environment for a PTY child: an isolated HOME, the real PATH (the child still needs to
 * find `sh`, `node`, …), and a known TERM.
 *
 * The environment is deliberately minimal rather than a copy of `process.env` — a PTY run must not
 * inherit real provider API keys, and an explicit base makes every variable the child can see
 * visible at the call site. Pass `overrides` for anything else the fixture needs (e.g. `EDITOR`).
 */
export function createPtyEnv(overrides: Readonly<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: createIsolatedHome(),
    TERM: 'xterm-256color',
    ...overrides,
  };
}
