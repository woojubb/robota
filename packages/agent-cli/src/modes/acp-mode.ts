import {
  SessionAuthorshipRefusedError,
  buildRuntimeSession,
  isSessionAuthorshipRefusedError,
  isSessionBusy,
  lockedSessionMessage,
  lockedSessionReason,
  restoredScheduleDisposition,
  scanSessionStore,
  claimedSessionMessage,
  SessionSlot,
} from '@robota-sdk/agent-framework';
import { isSessionClaimedError } from '@robota-sdk/agent-session';
import { createAcpTransport } from '@robota-sdk/agent-transport-acp';

import { runAcpSlashCommand } from './acp-command-port.js';
import { buildPooledSessionOptions } from './serve-mode.js';
import { shutdownSession } from './session-shutdown.js';

import type { IEditorFileSlot } from '../product/editor-file-slot.js';
import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type {
  IEditCheckpointStore,
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
  readonly createEditCheckpointStore?: () => IEditCheckpointStore;
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

/** What `session/load` says of a stored session that would start work on its own once loaded. */
function runsOnItsOwnMessage(sessionId: string): string {
  return (
    `Session ${sessionId} has a goal, loop or schedule that would run on its own; ` +
    'resume it in the terminal to stop that first.'
  );
}

/** A load refused while the session was being built from its claimed record. Fixed text only. */
class AcpLoadRefusedError extends Error {
  override readonly name = 'AcpLoadRefusedError';
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
  const unverifiedMessage = (sessionId: string, message: string): string =>
    /^[A-Za-z0-9._:-]{1,256}$/.test(sessionId)
      ? `${message} Review it in an interactive terminal with ${options.productRuntime.vocabulary.resumeCommand(sessionId)}.`
      : `${message} Review it by session id in an interactive terminal.`;

  const load = async (sessionId: string): Promise<TAcpSessionLoad> => {
    await slot.whenInitialized();
    if (slot.current.getStatusSnapshot().sessionId === sessionId) return { loaded: true };
    if (isSessionBusy(slot.current)) {
      return refuse('The current session has work in progress; load another once it finishes.');
    }
    // One read of the store decides it: a listed entry says everything, and only an id the listing
    // does not show is probed, since a sealed session whose keys are locked is not listed.
    const outcome = scanSessionStore(store).entries.find(
      (entry) => entry.id === sessionId,
    )?.outcome;
    if (
      (outcome?.status === 'corrupt' || outcome?.status === 'unsupported') &&
      outcome.cwd === options.cwd
    ) {
      return refuse(`Session ${sessionId} was saved in a form this version cannot read.`);
    }
    const lockedReason = outcome === undefined ? lockedSessionReason(store, sessionId) : undefined;
    if (lockedReason !== undefined) return refuse(lockedSessionMessage(sessionId, lockedReason));
    const record =
      outcome?.status === 'valid' && outcome.record.cwd === options.cwd
        ? outcome.record
        : undefined;
    if (record === undefined) return refuse(`No session ${sessionId} in this workspace.`);
    // An editor has no way yet to ask whether a record nobody vouched for is the owner's.
    if (outcome?.status === 'valid' && outcome.authorship === 'unverified') {
      return refuse(unverifiedMessage(sessionId, new SessionAuthorshipRefusedError(sessionId, 'unverified').message));
    }
    const disableSessionLoops = options.sessionOptions.disableSessionLoops ?? false;
    if (runsOnItsOwn(record, Date.now(), disableSessionLoops))
      return refuse(runsOnItsOwnMessage(sessionId));
    let next: InteractiveSession;
    try {
      next = buildRuntimeSession({
        ...buildPooledSessionOptions(
          options.sessionOptions,
          { createEditCheckpointStore: options.createEditCheckpointStore },
          sessionId,
        ),
        // The listing above was a look at the file; the record the session restores from is the
        // claim's own read, and it is judged again on that.
        checkRestoredRecord: (restored) => {
          if (runsOnItsOwn(restored, Date.now(), disableSessionLoops)) {
            throw new AcpLoadRefusedError(runsOnItsOwnMessage(sessionId));
          }
        },
      });
    } catch (error) {
      // The session this connection just left still holds the record while it shuts down, or a
      // subagent of a fork runs on it: the store's words say which.
      if (isSessionClaimedError(error)) return refuse(claimedSessionMessage(error));
      if (isSessionAuthorshipRefusedError(error) && error.reason === 'unverified') {
        return refuse(unverifiedMessage(sessionId, error.message));
      }
      if (error instanceof AcpLoadRefusedError || isSessionAuthorshipRefusedError(error)) {
        return refuse(error.message);
      }
      throw error;
    }
    try {
      await next.whenInitialized();
    } catch (error) {
      await shutdownSession(next, 'ACP session load failed', 'ACP');
      if (isSessionClaimedError(error)) return refuse(claimedSessionMessage(error));
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
