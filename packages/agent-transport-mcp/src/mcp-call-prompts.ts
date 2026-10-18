/**
 * The prompts one MCP call raises, held for the caller that made it.
 *
 * Every call the carrier serves runs under its own driver id, and the session stamps that id on
 * each prompt the call raises. While the call is in flight this subscribes the session's prompt
 * events and keeps only the prompts stamped with the call's id: a prompt of another caller, or of
 * nobody's turn, is never seen by this caller and is left for whoever listens for it. The session
 * parks a prompt only while someone listens, so the subscription lives exactly as long as the call
 * and, when it ends, the session's own detach reconciliation settles anything still parked.
 */
import {
  askAnswer,
  askElicitation,
  permissionDecision,
  permissionElicitation,
} from './mcp-prompt-forms.js';

import type { IMcpTransportSession } from './mcp-session.js';
import type { ClientCapabilities, ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/server';
import type {
  IAskRequestEvent,
  IPermissionRequestEvent,
  IPromptResolvedEvent,
  TDriverId,
} from '@robota-sdk/agent-interface-session';

export type TMcpCallPrompt =
  | { readonly kind: 'permission'; readonly event: IPermissionRequestEvent }
  | { readonly kind: 'ask'; readonly event: IAskRequestEvent };

/** The form that puts a prompt to the client, or `undefined` when the prompt cannot be expressed. */
export function promptForm(prompt: TMcpCallPrompt): ElicitRequestFormParams | undefined {
  return prompt.kind === 'permission'
    ? permissionElicitation(prompt.event)
    : askElicitation(prompt.event.request);
}

/**
 * Whether the client declared form-mode elicitation. A bare `elicitation: {}` is the pre-mode
 * declaration and counts as form support; a declaration naming only URL mode does not.
 */
export function clientDeclaresFormElicitation(capabilities: ClientCapabilities | undefined): boolean {
  const elicitation = capabilities?.elicitation;
  if (elicitation === undefined || elicitation === null || typeof elicitation !== 'object') {
    return false;
  }
  if (elicitation.form !== undefined) return true;
  return elicitation.url === undefined;
}

let callsMinted = 0;

/** A driver id for one call: `mcp:` and a number unique for the life of the process. */
export function mintCallDriverId(): TDriverId {
  return `mcp:${++callsMinted}`;
}

interface IWaiter {
  readonly resolve: (prompt: TMcpCallPrompt) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

export class McpCallPrompts {
  private readonly queue: TMcpCallPrompt[] = [];
  private waiter: IWaiter | undefined;
  /** What to run when the session settles a prompt this caller is still being asked about. */
  private readonly settledHooks = new Map<string, Set<() => void>>();
  private closed = false;

  constructor(
    private readonly session: IMcpTransportSession,
    readonly driverId: TDriverId,
  ) {
    session.on('permission_request', this.onPermissionRequest);
    session.on('ask_request', this.onAskRequest);
    session.on('prompt_resolved', this.onPromptResolved);
  }

  private readonly onPermissionRequest = (event: IPermissionRequestEvent): void => {
    if (event.requesterDriverId === this.driverId) this.push({ kind: 'permission', event });
  };

  private readonly onAskRequest = (event: IAskRequestEvent): void => {
    if (event.requesterDriverId === this.driverId) this.push({ kind: 'ask', event });
  };

  private readonly onPromptResolved = (event: IPromptResolvedEvent): void => {
    const queued = this.queue.findIndex((prompt) => prompt.event.id === event.id);
    if (queued >= 0) this.queue.splice(queued, 1);
    this.runSettledHooks(event.id);
  };

  private push(prompt: TMcpCallPrompt): void {
    if (this.closed) return;
    const waiter = this.waiter;
    if (waiter === undefined) {
      this.queue.push(prompt);
      return;
    }
    this.waiter = undefined;
    waiter.signal.removeEventListener('abort', waiter.onAbort);
    waiter.resolve(prompt);
  }

  /** The next prompt of this call; rejects when `signal` aborts or the call closes first. */
  next(signal: AbortSignal): Promise<TMcpCallPrompt> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed) return Promise.reject(new Error('The call has ended'));
    if (signal.aborted) return Promise.reject(new Error('No longer waiting for a prompt'));
    if (this.waiter !== undefined) return Promise.reject(new Error('Already waiting for a prompt'));
    return new Promise<TMcpCallPrompt>((resolve, reject) => {
      const onAbort = (): void => {
        this.waiter = undefined;
        reject(new Error('No longer waiting for a prompt'));
      };
      this.waiter = { resolve, reject, signal, onAbort };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Runs `hook` once if the session settles prompt `id` before this caller answers it. */
  whenSettled(id: string, hook: () => void): () => void {
    let hooks = this.settledHooks.get(id);
    if (hooks === undefined) {
      hooks = new Set();
      this.settledHooks.set(id, hooks);
    }
    hooks.add(hook);
    return () => {
      hooks.delete(hook);
      if (hooks.size === 0) this.settledHooks.delete(id);
    };
  }

  /**
   * Answers a prompt with what the client returned, attributed to this call; no result (the client
   * could not be asked, failed, or the ask is inexpressible) settles it closed: denied or cancelled.
   */
  settle(prompt: TMcpCallPrompt, result: ElicitResult | undefined): void {
    if (prompt.kind === 'permission') {
      const decision = result === undefined ? false : permissionDecision(result);
      this.session.resolvePermission(prompt.event.id, decision, this.driverId);
      return;
    }
    const answer =
      result === undefined ? { type: 'cancelled' as const } : askAnswer(prompt.event.request, result);
    this.session.resolveAsk(prompt.event.id, answer, this.driverId);
  }

  /** Stops listening. A question still out to the client is withdrawn before the session hears. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.settledHooks.keys()]) this.runSettledHooks(id);
    const waiter = this.waiter;
    if (waiter !== undefined) {
      this.waiter = undefined;
      waiter.signal.removeEventListener('abort', waiter.onAbort);
      waiter.reject(new Error('The call has ended'));
    }
    this.queue.length = 0;
    this.session.off('permission_request', this.onPermissionRequest);
    this.session.off('ask_request', this.onAskRequest);
    this.session.off('prompt_resolved', this.onPromptResolved);
  }

  private runSettledHooks(id: string): void {
    const hooks = this.settledHooks.get(id);
    if (hooks === undefined) return;
    this.settledHooks.delete(id);
    for (const hook of hooks) hook();
  }
}
