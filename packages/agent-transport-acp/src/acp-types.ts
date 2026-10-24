/** Public contract of the ACP agent transport: its session role set, host-injected ports and options. */

import type {
  ISessionCommands,
  ISessionConversationRead,
  ISessionEvents,
  ISessionPromptResolution,
  ISessionStatusRead,
  ISessionTurnControl,
  ISessionTurnSubmission,
  ISubmitOptions,
  TDriverId,
} from '@robota-sdk/agent-interface-session';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
import type { Readable, Writable } from 'node:stream';

/**
 * The session roles ACP uses: submit and abort a turn, stream its events, answer its permission
 * prompts, and name the session. Optional catalog reads let the editor offer commands; optional
 * history reads enable a host load port to replay a stored session. A full interactive session is assignable.
 */
export interface IAcpTransportSession
  extends
    ISessionTurnSubmission,
    ISessionTurnControl,
    ISessionEvents,
    ISessionPromptResolution,
    ISessionStatusRead,
    Partial<Pick<ISessionCommands, 'listCommands' | 'listSkills'>>,
    Partial<Pick<ISessionConversationRead, 'getMessagesDisplay'>> {
  /**
   * Resolves once the session can name itself, and rejects if it failed to start. A session that
   * builds itself in the background (`InteractiveSession`) has no id before then, so `session/new`
   * and `session/load` wait on this. A session that is ready at construction can omit it.
   */
  whenInitialized?(): Promise<void>;
}

/**
 * The editor's file system, as the editor offered it (`clientCapabilities.fs`): a method it did not
 * offer is absent. Paths are absolute. A failure rejects with the editor's reason.
 */
export interface IAcpEditorFileAccess {
  readTextFile?(path: string, signal?: AbortSignal): Promise<string>;
  writeTextFile?(path: string, content: string, signal?: AbortSignal): Promise<void>;
}

/** The host's answer to whether the workspace may serve an editor; a refusal carries what to tell the user. */
export type TAcpWorkspaceAdmission =
  { readonly admitted: true } | { readonly admitted: false; readonly message: string };

/** The host's answer to a `session/load`; a refusal carries what to tell the editor. */
export type TAcpSessionLoad =
  { readonly loaded: true } | { readonly loaded: false; readonly message: string };

export interface IAcpTransportOptions {
  /** Process-owned byte streams carrying newline-delimited JSON-RPC: the editor writes `input`, reads `output`. */
  readonly input: Readable;
  readonly output: Writable;
  /** Sent to the editor in the `initialize` reply. */
  readonly agentInfo: { readonly name: string; readonly version: string };
  /** The directory the attached session is rooted at; `session/new` and `session/load` must name it. */
  readonly cwd: string;
  /** The host's trust check, asked when the editor creates or loads the session. */
  readonly admitWorkspace: () => TAcpWorkspaceAdmission;
  /**
   * Runs a `/command` prompt and returns the text to show. Supplied by the host because command
   * execution belongs to the framework layer this package may not import; without it a `/command`
   * prompt is answered with a notice that commands are unavailable. `signal` aborts when the editor
   * cancels the prompt or the connection closes; pass it on so what the command starts stops with it.
   */
  readonly executeCommand?: (text: string, signal: AbortSignal) => Promise<string>;
  /**
   * Makes the stored session `sessionId` current, so that the object this transport was attached to
   * answers for it from then on (the host attaches a forwarder, such as a session slot, whose current
   * session the port replaces). It must admit only a session rooted in the served directory, and may
   * refuse with a message for the editor. Supplied by the host because building a session from
   * storage is not this package's; without it or the session's history read, `session/load` is not offered.
   */
  readonly loadSession?: (sessionId: string) => Promise<TAcpSessionLoad>;
  /**
   * Receives the editor's file system after a new or loaded session binds, when the editor offers reads or
   * writes, and `undefined` when the transport stops. The host decides which of its tools use it;
   * they must apply their own path and permission checks first, because the editor checks nothing
   * for the agent. Never called for an editor that offers no file system.
   */
  readonly onEditorFileAccess?: (access: IAcpEditorFileAccess | undefined) => void;
  /** Attribution recorded on turns and prompt answers submitted through this transport. Default `'owner'`. */
  readonly driverId?: TDriverId;
  /** Usage surface recorded on turns. Default `'unknown'` (no editor value exists). */
  readonly surface?: ISubmitOptions['surface'];
  /**
   * Called for an error the editor does not receive: a notification that could not be written, or a
   * turn failure whose detail is withheld from the editor's reply.
   */
  readonly onDeliveryError?: (error: Error, context: string) => void;
}

export interface IAcpTransport extends ITransportAdapter<IAcpTransportSession> {
  /** Settles when the editor's input ends, the output closes, or `stop()` runs; rejects if the output fails. */
  waitForClose(): Promise<void>;
}
