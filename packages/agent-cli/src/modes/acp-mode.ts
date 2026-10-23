import {
  buildRuntimeSession,
  isSessionBusy,
  listUnreadableSessionsForWorkspace,
  restoredScheduleDisposition,
  SessionSlot,
} from '@robota-sdk/agent-framework';
import { createAcpTransport } from '@robota-sdk/agent-transport-acp';

import { runAcpSlashCommand } from './acp-command-port.js';
import { buildPooledSessionOptions } from './serve-mode.js';
import { shutdownSession } from './session-shutdown.js';

import type { IEditorFileSlot } from '../product/editor-file-slot.js';
import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type {
  EditCheckpointStore,
  InteractiveSession,
  TInteractiveSessionOptions,
} from '@robota-sdk/agent-framework';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
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
  /** Where the session's file tools look for the editor's file system; the transport fills it. */
  readonly editorFiles?: IEditorFileSlot;
}

/** The connection's session: the one this process started, until the editor loads a stored one. */
class AcpSessionSlot extends SessionSlot<InteractiveSession> {
  whenInitialized(): Promise<void> {
    return this.current.whenInitialized();
  }
}

/**
 * Work a stored session would start on its own once loaded: a goal it is pursuing, a self-paced
 * loop that has not stopped or expired, or a scheduled task (a fixed-interval loop, a `/schedule`
 * wake) that restore re-arms to fire, by the framework's own re-arm rule. An editor sees only the
 * turns it prompts, so that work would run unseen and every permission it asked for would be denied.
 */
function runsOnItsOwn(
  record: IInteractiveSessionRecord,
  nowMs: number,
  sessionLoopsDisabled: boolean,
): boolean {
  if (record.goal?.status === 'active') return true;
  const hasLiveLoop = (record.sessionLoops ?? []).some(
    (loop) =>
      loop.phase !== 'stopped' && loop.phase !== 'expired' && Date.parse(loop.expiresAt) > nowMs,
  );
  return (
    hasLiveLoop ||
    (record.backgroundTasks ?? []).some(
      (task) => restoredScheduleDisposition(task, nowMs, sessionLoopsDisabled) === 'rearm',
    )
  );
}

interface ISessionLoader {
  readonly load: (sessionId: string) => Promise<TAcpSessionLoad>;
  /** Stop accepting loads and wait for one in progress, so teardown shuts the session it left current. */
  close(): Promise<void>;
}

/**
 * How `session/load` reaches a stored session: only one of this folder that this build can read and
 * that will not run on its own, built from the same options with it as the resume id, replacing the
 * session the connection had once that session has no work in progress. Without a session store
 * nothing was saved to load, so the editor is not offered loading.
 */
function createSessionLoader(
  options: IAcpModeOptions,
  slot: AcpSessionSlot,
): ISessionLoader | undefined {
  const store = options.sessionOptions.sessionStore;
  if (store === undefined) return undefined;
  let closing = false;
  let pending: Promise<unknown> = Promise.resolve();
  const refuse = (message: string): TAcpSessionLoad => ({ loaded: false, message });

  const load = async (sessionId: string): Promise<TAcpSessionLoad> => {
    await slot.whenInitialized();
    if (slot.current.getStatusSnapshot().sessionId === sessionId) return { loaded: true };
    if (isSessionBusy(slot.current)) {
      return refuse('The current session has work in progress; load another once it finishes.');
    }
    if (listUnreadableSessionsForWorkspace(store, options.cwd).some((e) => e.id === sessionId)) {
      return refuse(`Session ${sessionId} was saved in a form this version cannot read.`);
    }
    const record = store
      .list()
      .flatMap((entry) => (entry.outcome.status === 'valid' ? [entry.outcome.record] : []))
      .find((candidate) => candidate.id === sessionId && candidate.cwd === options.cwd);
    if (record === undefined) return refuse(`No session ${sessionId} in this workspace.`);
    if (runsOnItsOwn(record, Date.now(), options.sessionOptions.disableSessionLoops ?? false)) {
      return refuse(
        `Session ${sessionId} has a goal, loop or schedule that would run on its own; ` +
          'resume it in the terminal to stop that first.',
      );
    }
    const next = buildRuntimeSession(
      buildPooledSessionOptions(
        options.sessionOptions,
        { createEditCheckpointStore: options.createEditCheckpointStore },
        sessionId,
      ),
    );
    try {
      await next.whenInitialized();
    } catch (error) {
      await shutdownSession(next, 'ACP session load failed', 'ACP');
      throw error;
    }
    // The editor went away while the stored session started: it is not served, so it is shut down.
    if (closing) {
      await shutdownSession(next, 'ACP carrier closed during a session load', 'ACP');
      return refuse('The agent is shutting down.');
    }
    await slot.replace(next, 'ACP session loaded');
    return { loaded: true };
  };

  return {
    load(sessionId) {
      if (closing) return Promise.resolve(refuse('The agent is shutting down.'));
      const attempt = load(sessionId);
      pending = attempt.catch(() => undefined);
      return attempt;
    },
    async close() {
      closing = true;
      await pending;
    },
  };
}

/** One product session, one ACP carrier; process signals and exit policy belong to this shell. */
export async function runAcpMode(options: IAcpModeOptions): Promise<void> {
  const slot = new AcpSessionSlot(buildRuntimeSession(options.sessionOptions));
  const loader = createSessionLoader(options, slot);
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
    ...(loader !== undefined ? { loadSession: loader.load } : {}),
    ...(options.editorFiles !== undefined ? { onEditorFileAccess: options.editorFiles.set } : {}),
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
      await loader?.close();
      await shutdownSession(slot.current, 'ACP stdio carrier closed', 'ACP');
    }
  }
}
