import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { IDagCliIo } from '../types.js';
import { SUCCESS_EXIT_CODE, FAILURE_EXIT_CODE } from '../types.js';
import { startStudioServer } from '../studio/http-server.js';
import { applyEnvFile } from './run.js';

const DEFAULT_PORT = 7777;

export interface IStudioCommandOptions {
  readonly io: IDagCliIo;
}

/**
 * Open `url` in the user's default browser.
 *
 * SEC-006: the URL embeds a user-supplied file path, so it is passed as its own ARGV element and the
 * child is spawned WITHOUT a shell — `exec()` always runs its argument through a shell, which made the
 * command a string a crafted path could break out of. On win32 `start` is a `cmd` builtin rather than an
 * executable, so we invoke `cmd` directly with `['/c', 'start', '', url]` (the empty string is `start`'s
 * window-title argument). No `shell` option on any platform: `cmd.exe` is itself an executable, and
 * setting `shell: true` would make Node re-join these argv elements into a command string — exactly the
 * concatenation this change removes.
 */
function openBrowser(url: string): void {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = isWindows ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => {
      // allow-fallback: browser open failure is non-fatal; user can open the URL manually
    });
    child.unref();
  } catch {
    // allow-fallback: browser open failure is non-fatal; user can open the URL manually
  }
}

function waitForSigint(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGINT', () => {
      resolve();
    });
  });
}

/**
 * `dag studio [file]` — start a local web UI for visualising and running DAG files.
 *
 * Opens a browser pointing at http://127.0.0.1:<port>/?file=<absolute-path> (when a file is given).
 * The server runs until the user presses Ctrl+C.
 */
export async function studioCommand(
  args: readonly string[],
  options: IStudioCommandOptions,
): Promise<number> {
  const { io } = options;
  const cwd = process.cwd();

  // Optional positional: DAG file path.
  const fileArg = args.find((a) => !a.startsWith('--'));
  const absFilePath = fileArg ? resolve(cwd, fileArg) : undefined;

  // Optional --port flag.
  const portFlagIdx = args.indexOf('--port');
  const portRaw = portFlagIdx !== -1 ? args[portFlagIdx + 1] : undefined;
  const port = portRaw !== undefined ? parseInt(portRaw, 10) : DEFAULT_PORT;

  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    io.write(`Error: --port must be a valid port number (1–65535).\n`);
    return FAILURE_EXIT_CODE;
  }

  // Load .env so LLM API keys (ANTHROPIC_API_KEY etc.) are available during DAG runs.
  await applyEnvFile(resolve(cwd, '.env'));

  let serverInfo: { port: number };
  try {
    serverInfo = await startStudioServer(port, { cwd });
  } catch (e) {
    // allow-fallback: all preferred ports exhausted; surface error and exit
    io.writeError(
      `Error: Could not start studio server (tried ports ${port}–${port + 9}): ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return FAILURE_EXIT_CODE;
  }

  const base = `http://127.0.0.1:${serverInfo.port}`;
  const url = absFilePath ? `${base}/?file=${encodeURIComponent(absFilePath)}` : `${base}/`;

  io.write(`\nDAG Studio listening on port ${serverInfo.port}\n`);
  io.write(`URL: ${url}\n`);
  io.write(`Press Ctrl+C to stop.\n\n`);

  openBrowser(url);
  await waitForSigint();

  io.write(`\nDAG Studio stopped.\n`);
  return SUCCESS_EXIT_CODE;
}
