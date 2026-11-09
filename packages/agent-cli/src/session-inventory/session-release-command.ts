/**
 * `session release <id> [--force]` — the user's way to remove a session's writer marker.
 *
 * Every process that opens a session holds its writer marker beside the records, and a second opener
 * is refused while the marker's owner runs or cannot be told running. A process that crashed leaves
 * its marker behind: where the start time of a process can be read, a later opener breaks it on its
 * own, but on Windows (no start time) or when the machine cannot be told, it stands until released.
 * Any program of the same user can plant a marker, so a planted one is a denial of service and this
 * is its remedy.
 *
 * Without `--force` only a marker whose owner is provably gone is removed. `--force` removes whatever
 * stands, which takes the fence away from a writer that may still be running, so it is asked on the
 * controlling terminal, never from standard input or a flag alone: an agent or a script cannot answer
 * it. The command is the user's own, never a model-invocable command.
 */

import { createProcessOperationLock } from '@robota-sdk/agent-session/node';

import { join } from 'node:path';

import { createProcessMarkers } from '@robota-sdk/agent-core/node';
import { getWorkspaceProjectStateStorage } from '@robota-sdk/agent-framework';
import { projectSessionClaimsDirectory } from '@robota-sdk/agent-framework/node';
import { isSafeSessionId } from '@robota-sdk/agent-session';
import { SESSION_CLAIMS_DIRECTORY } from '@robota-sdk/agent-session/node';

import { openSecretTerminal } from '../devices/secret-terminal.js';
import { isYes } from '../remote-control/operator-approval.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { IProcessMarkerHolder, IProcessMarkers } from '@robota-sdk/agent-core';
import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

/** Where a session store keeps its writer markers, named for the user. */
export interface ISessionClaimsLocation {
  readonly label: 'your session store' | "this project's session store";
  readonly directory: string;
}

export interface ISessionReleaseCommandOptions {
  readonly cliName: string;
  /** The claims directories to look in: the user's store's, and the trusted project's when there is one. */
  readonly locations: readonly ISessionClaimsLocation[];
  /** Whether standard input and output are a terminal; read from the process by default. */
  readonly isTTY?: boolean;
  /** Asks the user on the controlling terminal; reads the terminal by default. */
  readonly confirm?: (question: string) => Promise<boolean>;
  /** The markers of a directory; the file markers by default. */
  readonly markersOf?: (directory: string) => IProcessMarkers;
  readonly write?: (text: string) => void;
  readonly writeError?: (text: string) => void;
}

const USAGE = (cliName: string): string =>
  `Usage: ${cliName} session release <session-id> [--force]\n`;

/**
 * Where this product keeps writer markers for the workspace: the user's own store's claims, and the
 * trusted project's store's claims, reached through its authority-gated state facet.
 */
export function productSessionClaimsLocations(
  runtime: ICliRuntimeContext,
  projectAccess: TWorkspaceProjectAccess,
): readonly ISessionClaimsLocation[] {
  const user: ISessionClaimsLocation = {
    label: 'your session store',
    directory: join(runtime.layout.userPaths.sessions, SESSION_CLAIMS_DIRECTORY),
  };
  if (projectAccess.status !== 'trusted') return [user];
  return [
    user,
    {
      label: "this project's session store",
      directory: projectSessionClaimsDirectory(
        getWorkspaceProjectStateStorage(projectAccess.authority, 'sessions'),
      ),
    },
  ];
}

function holderText(holder: IProcessMarkerHolder): string {
  const owner = holder.owner;
  if (owner === undefined) return 'a writer this process cannot read';
  const parts = [`pid ${owner.pid}`];
  if (owner.hostname !== undefined) parts.push(`on ${owner.hostname}`);
  if (owner.startTime !== undefined) parts.push(`started ${owner.startTime}`);
  const state = holder.self
    ? 'this process'
    : holder.liveness === 'alive'
      ? 'running'
      : holder.liveness === 'gone'
        ? 'no longer running'
        : 'cannot be told running or not';
  return `${parts.join(' ')} (${state})`;
}

/** Asks on the controlling terminal; no interactive terminal, Ctrl-C or EOF mean no. */
async function confirmOnTerminal(question: string): Promise<boolean> {
  const terminal = openSecretTerminal();
  if (terminal === undefined) return false;
  try {
    return await terminal.run(async (io) => {
      io.write(`${question}\r\n`);
      return isYes(await io.readLine('Remove the writer marker? [y/N] ', { echo: true }));
    });
  } catch {
    return false;
  }
}

/** Runs `session release`; resolves to the exit code. */
export async function runSessionReleaseCommand(
  argv: readonly string[],
  options: ISessionReleaseCommandOptions,
): Promise<number> {
  const write = options.write ?? ((text: string) => void process.stdout.write(text));
  const writeError = options.writeError ?? ((text: string) => void process.stderr.write(text));
  const { cliName } = options;
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    write(USAGE(cliName));
    return 0;
  }
  const [id, ...flags] = argv;
  const force = flags.includes('--force');
  if (
    id === undefined ||
    !isSafeSessionId(id) ||
    flags.some((flag) => flag !== '--force') ||
    new Set(flags).size !== flags.length
  ) {
    writeError(USAGE(cliName));
    return 1;
  }
  const markersOf =
    options.markersOf ??
    ((directory: string) =>
      createProcessMarkers(directory, { operationLock: createProcessOperationLock(directory) }));
  const standing = options.locations.flatMap((location) => {
    const markers = markersOf(location.directory);
    const state = markers.inspect(id);
    return state.status === 'held' ? [{ location, markers, holder: state.holder }] : [];
  });
  if (standing.length === 0) {
    write(`Session ${id} has no writer marker; nothing to release.\n`);
    return 0;
  }
  if (
    force &&
    !(options.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true))
  ) {
    writeError(
      `${cliName} session release --force needs an interactive terminal and your confirmation, since ` +
        `it can take the fence away from a writer that still runs. Run it yourself: ` +
        `${cliName} session release ${id} --force\n`,
    );
    return 1;
  }
  let exitCode = 0;
  for (const { location, markers, holder } of standing) {
    const where = `in ${location.label}`;
    if (!force) {
      if (holder.liveness !== 'gone') {
        writeError(
          `Session ${id} ${where} is held by ${holderText(holder)}. Close it there; if that process is ` +
            `no longer running, release it with: ${cliName} session release ${id} --force\n`,
        );
        exitCode = 1;
        continue;
      }
      const removed = markers.remove(id);
      if (removed.status === 'removed' || removed.status === 'absent') {
        write(`Released session ${id} ${where}: its writer, ${holderText(holder)}, had ended.\n`);
      } else {
        writeError(`Session ${id} ${where} is changing right now; try again.\n`);
        exitCode = 1;
      }
      continue;
    }
    const question =
      `Session ${id} ${where} is held by ${holderText(holder)}.\r\n` +
      'The writer and already running child processes may continue doing work after release. ' +
      'Stop the writer and its children first; releasing the marker does not stop them.';
    if (!(await (options.confirm ?? confirmOnTerminal)(question))) {
      writeError(`Session ${id} ${where} was not released.\n`);
      exitCode = 1;
      continue;
    }
    const removed = markers.remove(id, { force: true });
    if (removed.status === 'busy') {
      writeError(`Session ${id} ${where} is changing right now; try again.\n`);
      exitCode = 1;
      continue;
    }
    write(`Released session ${id} ${where}.\n`);
  }
  return exitCode;
}
