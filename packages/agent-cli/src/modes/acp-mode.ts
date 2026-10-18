import {
  buildRuntimeSession,
  listResumableSessionSummaries,
  SessionSlot,
} from '@robota-sdk/agent-framework';
import { createAcpTransport } from '@robota-sdk/agent-transport-acp';

import { runAcpSlashCommand } from './acp-command-port.js';
import { shutdownSession } from './session-shutdown.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type {
  EditCheckpointStore,
  InteractiveSession,
  TInteractiveSessionOptions,
} from '@robota-sdk/agent-framework';
import type { TAcpSessionLoad, TAcpWorkspaceAdmission } from '@robota-sdk/agent-transport-acp';
import type { Readable, Writable } from 'node:stream';

export interface IAcpModeOptions {
  readonly productRuntime: ICliRuntimeContext;
  readonly sessionOptions: TInteractiveSessionOptions;
  readonly version: string;
  /** The directory the session is rooted at; the editor's `session/new` must name it. */
  readonly cwd: string;
  /** The process input, and the protocol-only output reserved before startup could print to stdout. */
  readonly input: Readable;
  readonly output: Writable;
  readonly admitWorkspace: () => TAcpWorkspaceAdmission;
  /** Builds a loaded session's own edit checkpoint store, as each served session has its own. */
  readonly createEditCheckpointStore?: () => EditCheckpointStore;
}

/** The connection's session: the one this process started, until the editor loads a stored one. */
class AcpSessionSlot extends SessionSlot<InteractiveSession> {
  whenInitialized(): Promise<void> {
    return this.current.whenInitialized();
  }
}

/**
 * How `session/load` reaches a stored session: only one this workspace can resume, built from the
 * same options with it as the resume id, replacing the session the connection had. Without a session
 * store nothing was saved to load, so the editor is not offered loading.
 */
function createSessionLoader(
  options: IAcpModeOptions,
  slot: AcpSessionSlot,
): ((sessionId: string) => Promise<TAcpSessionLoad>) | undefined {
  const store = options.sessionOptions.sessionStore;
  if (store === undefined) return undefined;
  return async (sessionId) => {
    await slot.whenInitialized();
    if (slot.current.getStatusSnapshot().sessionId === sessionId) return { loaded: true };
    const resumable = listResumableSessionSummaries(store, options.cwd);
    if (!resumable.some((summary) => summary.id === sessionId)) {
      return { loaded: false, message: `No session ${sessionId} in this workspace.` };
    }
    const next = buildRuntimeSession({
      ...options.sessionOptions,
      // Exactly the stored session: the launch's fork and name do not carry over.
      resumeSessionId: sessionId,
      forkSession: undefined,
      sessionName: undefined,
      ...(options.createEditCheckpointStore !== undefined
        ? { editCheckpointStore: options.createEditCheckpointStore() }
        : {}),
    });
    try {
      await next.whenInitialized();
    } catch (error) {
      await shutdownSession(next, 'ACP session load failed', 'ACP');
      throw error;
    }
    await slot.replace(next, 'ACP session loaded');
    return { loaded: true };
  };
}

/** One product session, one ACP carrier; process signals and exit policy belong to this shell. */
export async function runAcpMode(options: IAcpModeOptions): Promise<void> {
  const slot = new AcpSessionSlot(buildRuntimeSession(options.sessionOptions));
  const loadSession = createSessionLoader(options, slot);
  const transport = createAcpTransport({
    input: options.input,
    output: options.output,
    agentInfo: {
      name: options.productRuntime.config.identity.cliName,
      version: options.version,
    },
    cwd: options.cwd,
    admitWorkspace: options.admitWorkspace,
    executeCommand: (text, signal) => runAcpSlashCommand(slot, text, signal),
    ...(loadSession !== undefined ? { loadSession } : {}),
    // stdout carries the protocol; what the editor does not receive goes where logs go.
    onDeliveryError: (error, context) => {
      process.stderr.write(`ACP ${context}: ${error.message}\n`);
    },
  });
  transport.attach(slot);
  let onStop: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    onStop = resolve;
  });
  const signal = (): void => onStop?.();
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    // A signal or the editor closing its input must reach teardown even while the carrier starts.
    await Promise.race([transport.start(), transport.waitForClose(), stopped]);
    await Promise.race([transport.waitForClose(), stopped]);
  } finally {
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    try {
      await transport.stop();
    } finally {
      await shutdownSession(slot.current, 'ACP stdio carrier closed', 'ACP');
    }
  }
}
