import { lstatSync } from 'node:fs';

import { createUserSessionStore } from '@robota-sdk/agent-framework';
import { admitLocalPeerDirectory } from '@robota-sdk/agent-remote-pairing/local';

import { listPeers } from '../remote-control/local-peer-registry.js';
import { resolveRendezvousDirectory } from '../remote-control/local-peer-rendezvous.js';
import { userPaths } from '../product/user-paths.js';
import { listSupervisedSessions } from './supervised-session-control.js';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

interface IPeer {
  readonly sessionId: string;
  readonly liveness: 'alive' | 'dead' | 'unknown';
  readonly status: 'working' | 'needs-input' | 'idle' | 'unknown';
}

export interface ISessionListDependencies {
  readonly userSessionStore: IInteractiveSessionStore;
  readonly projectSessionStore?: IInteractiveSessionStore;
  readonly readPeers: () =>
    | { readonly status: 'available'; readonly peers: readonly IPeer[] }
    | { readonly status: 'unavailable' };
}

interface IResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const HELP = 'Usage: robota session list [--format text|json]\n';

/** Inspect, but never create or change, the guarded same-user peer rendezvous. */
export function readLocalPeersForInventory(
  directory: string = resolveRendezvousDirectory(),
): ReturnType<ISessionListDependencies['readPeers']> {
  try {
    if (lstatSync(directory).isSymbolicLink()) return { status: 'unavailable' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'available', peers: [] };
    }
    return { status: 'unavailable' };
  }
  const admission = admitLocalPeerDirectory(directory, { expectedUid: process.getuid?.() ?? 0 });
  if (!admission.admitted || !admission.binding) return { status: 'unavailable' };
  try {
    return {
      status: 'available',
      peers: listPeers({ guardedDirectory: admission.binding.guardedDirectory }).map((peer) => ({
        sessionId: peer.entry.sessionId,
        liveness: peer.liveness,
        status: peer.status,
      })),
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export function executeSessionListCommand(
  argv: readonly string[],
  dependencies: ISessionListDependencies,
): IResult {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { exitCode: 0, stdout: HELP, stderr: '' };
  }
  const format =
    argv.length === 0 ? 'text' : argv.length === 2 && argv[0] === '--format' ? argv[1] : undefined;
  if (format !== 'text' && format !== 'json') {
    return { exitCode: 1, stdout: '', stderr: HELP };
  }

  try {
    const peerSnapshot = dependencies.readPeers();
    const live = {
      status: peerSnapshot.status,
      processes:
        peerSnapshot.status === 'available'
          ? peerSnapshot.peers
              .filter((peer) => peer.liveness !== 'dead')
              .map((peer) => ({
                id: peer.sessionId,
                liveness: peer.liveness,
                activity: peer.liveness === 'alive' ? peer.status : 'unknown',
              }))
              .sort((a, b) => a.id.localeCompare(b.id))
          : [],
    };
    const savedById = new Map<
      string,
      { id: string; availability: string; source: 'user' | 'project' }
    >();
    for (const [source, store] of [
      ['user', dependencies.userSessionStore],
      ['project', dependencies.projectSessionStore],
    ] as const) {
      for (const entry of store?.list() ?? []) {
        if (entry.outcome.status === 'missing') continue;
        savedById.set(entry.id, { id: entry.id, availability: entry.outcome.status, source });
      }
    }
    const saved = [...savedById.values()].sort((a, b) => a.id.localeCompare(b.id));
    const stdout =
      format === 'json'
        ? `${JSON.stringify({ live, saved })}\n`
        : [
            'Live processes (not linked to saved sessions):',
            live.status === 'unavailable'
              ? '  (unavailable)'
              : live.processes.length === 0
                ? '  (none)'
                : live.processes
                    .map(
                      (peer) =>
                        `  ${JSON.stringify(peer.id)}  liveness ${peer.liveness}  activity ${peer.activity}`,
                    )
                    .join('\n'),
            'Saved sessions (not linked to live processes):',
            saved.length === 0
              ? '  (none)'
              : saved
                  .map(
                    (session) =>
                      `  ${JSON.stringify(session.id)}  ${session.availability}  ${session.source}`,
                  )
                  .join('\n'),
          ].join('\n') + '\n';
    return {
      exitCode: live.status === 'unavailable' ? 1 : 0,
      stdout,
      stderr:
        live.status === 'unavailable'
          ? 'Local peer discovery is unavailable; saved session listing is shown separately.\n'
          : '',
    };
  } catch {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Unable to enumerate local sessions.\n',
    };
  }
}

export async function runSessionListCommand(
  argv: readonly string[],
  projectSessionStore?: IInteractiveSessionStore,
): Promise<number> {
  const result = executeSessionListCommand(argv, {
    userSessionStore: createUserSessionStore(userPaths().sessions),
    ...(projectSessionStore ? { projectSessionStore } : {}),
    readPeers: readLocalPeersForInventory,
  });
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stdout.write(result.stdout);
    return result.exitCode;
  }
  if (!result.stdout) {
    if (result.stderr) process.stderr.write(result.stderr);
    return result.exitCode;
  }
  let supervised: { status: 'available' | 'unavailable'; sessions: Awaited<ReturnType<typeof listSupervisedSessions>> };
  try {
    supervised = {
      status: 'available',
      sessions: await listSupervisedSessions(undefined, undefined, { includeExternalEvents: true }),
    };
  } catch {
    supervised = { status: 'unavailable', sessions: [] };
  }
  const format = argv[1] === 'json' ? 'json' : 'text';
  if (format === 'json') {
    const base = JSON.parse(result.stdout) as Record<string, unknown>;
    process.stdout.write(`${JSON.stringify({ ...base, supervised })}\n`);
  } else {
    const rows = supervised.status === 'unavailable'
      ? '  (unavailable)'
      : supervised.sessions.length === 0
        ? '  (none)'
        : supervised.sessions.map((row) => `  ${row.id}  liveness ${row.liveness}  control ${row.control}  activity ${row.activity}${row.problem ? `  ${row.problem}` : ''}`).join('\n');
    process.stdout.write(`${result.stdout}Supervised sessions (owned, not linked to peers or saved records):\n${rows}\n`);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  if (supervised.status === 'unavailable') {
    process.stderr.write('Supervised session discovery is unavailable.\n');
  }
  return result.exitCode || (supervised.status === 'unavailable' ? 1 : 0);
}
