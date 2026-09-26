/** Node defaults for {@link IDoctorDeps}: a TCP connect probe and read-only filesystem facts. */
import { accessSync, constants, existsSync, statSync, type Stats } from 'node:fs';
import { createConnection } from 'node:net';
import { delimiter, isAbsolute, join } from 'node:path';

import { ownerOnlyGuarantee } from '@robota-sdk/agent-core/node';

import type { IDoctorDeps, IDoctorEndpointProbeResult, IDoctorPathFacts } from './doctor-types.js';

const NETWORK_CHECK_TIMEOUT_MS = 3000;
const MS_PER_SECOND = 1000;
const MODE_BITS = 0o777;

/** TCP connect with a bounded timeout; a refusal or a timeout is a result, never a throw. */
export function probeEndpointViaSocket(
  host: string,
  port: number,
): Promise<IDoctorEndpointProbeResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({
        reachable: false,
        error: `timeout (${NETWORK_CHECK_TIMEOUT_MS / MS_PER_SECOND}s)`,
      });
    }, NETWORK_CHECK_TIMEOUT_MS);
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ reachable: true, elapsedMs: Date.now() - start });
    });
    socket.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ reachable: false, error: error.message });
    });
  });
}

/** Existence, directory-ness, `W_OK` and mode — probed without writing. */
export function inspectPathFacts(path: string): IDoctorPathFacts {
  if (!existsSync(path)) return { exists: false, isDirectory: false, writable: false };
  let stat: Stats;
  try {
    stat = statSync(path);
  } catch {
    // allow-fallback: a path that exists but cannot be stat'ed is reported as not a writable directory
    return { exists: true, isDirectory: false, writable: false };
  }
  const isDirectory = stat.isDirectory();
  const mode = stat.mode & MODE_BITS;
  let writable = false;
  try {
    accessSync(path, constants.W_OK);
    writable = true;
  } catch {
    // allow-fallback: W_OK refused IS the fact being reported
    writable = false;
  }
  return { exists: true, isDirectory, writable, mode };
}

/** A bare command resolves through `PATH`; a path-form command must exist as given. */
export function resolveCommandOnPath(
  command: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const executable = command.trim().split(/\s+/)[0];
  if (executable === undefined || executable.length === 0) return false;
  if (isAbsolute(executable) || executable.includes('/')) return existsSync(executable);
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  return (env.PATH ?? '')
    .split(delimiter)
    .filter((dir) => dir.length > 0)
    .some((dir) => extensions.some((ext) => existsSync(join(dir, executable + ext))));
}

export function createNodeDoctorDeps(
  env: Readonly<Record<string, string | undefined>> = process.env,
): IDoctorDeps {
  return {
    probeEndpoint: probeEndpointViaSocket,
    inspectPath: inspectPathFacts,
    resolveCommand: (command) => resolveCommandOnPath(command, env),
    ownerOnlyGuarantee: () => ownerOnlyGuarantee(),
  };
}
