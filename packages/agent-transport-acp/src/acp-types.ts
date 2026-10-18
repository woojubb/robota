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
 * prompts, name the session, list the commands an editor may offer, and read the history a loaded
 * session replays. A full interactive session is assignable; nothing else is required.
 */
export interface IAcpTransportSession
  extends
    ISessionTurnSubmission,
    ISessionTurnControl,
    ISessionEvents,
    ISessionPromptResolution,
    ISessionStatusRead,
    Pick<ISessionCommands, 'listCommands' | 'listSkills'>,
    Pick<ISessionConversationRead, 'getMessagesDisplay'> {
  /**
   * Resolves once the session can name itself, and rejects if it failed to start. A session that
   * builds itself in the background (`InteractiveSession`) has no id before then, so `session/new`
   * and `session/load` wait on this. A session that is ready at construction can omit it.
   */
  whenInitialized?(): Promise<void>;
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
   * prompt is answered with a notice that commands are unavailable.
   */
  readonly executeCommand?: (text: string, signal: AbortSignal) => Promise<string>;
  /**
   * Makes the stored session `sessionId` current, so that the object this transport was attached to
   * answers for it from then on (the host attaches a forwarder, such as a session slot, whose current
   * session the port replaces). It must admit only a session rooted in the served directory, and may
   * refuse with a message for the editor. Supplied by the host because building a session from
   * storage is not this package's; without it the agent does not offer `session/load`.
   */
  readonly loadSession?: (sessionId: string) => Promise<TAcpSessionLoad>;
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
