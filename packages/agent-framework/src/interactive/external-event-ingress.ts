import { isTurnNotRunError } from '@robota-sdk/agent-interface-session';

import type { ISubmitOptions, ITurnHandle, TTurnNotRunReason } from '@robota-sdk/agent-interface-session';
import type { TPermissionMode } from '@robota-sdk/agent-core';

/** Identity and content attested by a trusted source adapter, never parsed from prompt text. */
export interface IAuthenticatedExternalEvent {
  readonly senderId: string;
  readonly conversationId: string;
  readonly content: string;
}

export interface IExternalEventSourceOptions {
  readonly id: string;
  readonly allowedSenders: readonly string[];
  /** Verify the platform signature/credential and return its real sender; null means unauthenticated. */
  readonly authenticate: (raw: unknown) => IAuthenticatedExternalEvent | null | Promise<IAuthenticatedExternalEvent | null>;
}

export type TExternalEventSettlement =
  | { readonly outcome: 'completed'; readonly response: string }
  | { readonly outcome: 'interrupted' }
  | { readonly outcome: 'not-run'; readonly reason: TTurnNotRunReason }
  | { readonly outcome: 'failed'; readonly reason: string };

export interface IExternalEventReceipt {
  readonly outcome: 'accepted' | 'ignored' | 'refused';
  readonly reason?: string;
  readonly turnId?: string;
  readonly settled?: Promise<TExternalEventSettlement>;
}

export interface IExternalEventSource {
  receive(raw: unknown): Promise<IExternalEventReceipt>;
  /** Stop admission synchronously; already-submitted turns retain their exact settlement. */
  close(): void;
}

export interface IExternalEventHost {
  getPermissionMode(): TPermissionMode;
  addPermissionModeGuard(guard: (next: TPermissionMode) => void): () => void;
  submit(input: string, options: ISubmitOptions): Promise<ITurnHandle>;
}

const MAX_EVENT_BYTES = 16 * 1024;
const MAX_ID_LENGTH = 128;

function validIdentity(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) return false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  return true;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&apos;';
    }
  });
}

interface ISourceState {
  readonly id: string;
  readonly allowedSenders: ReadonlySet<string>;
  readonly authenticate: IExternalEventSourceOptions['authenticate'];
  active: boolean;
  pending: number;
}

/** Session-owned admission and turn settlement; adapters own platform authentication. */
export class ExternalEventIngress {
  private readonly sources = new Map<string, ISourceState>();
  private pending = 0;
  private releaseGuard?: () => void;

  constructor(private readonly host: IExternalEventHost) {}

  open(options: IExternalEventSourceOptions): IExternalEventSource {
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(options.id)) {
      throw new Error('external event source id must be 1–64 ASCII letters, digits, underscores or hyphens');
    }
    if (this.sources.has(options.id)) throw new Error(`external event source ${options.id} is already registered`);
    if (this.host.getPermissionMode() === 'bypassPermissions') {
      throw new Error('external event ingress cannot run in bypassPermissions mode');
    }
    const state: ISourceState = {
      id: options.id,
      allowedSenders: new Set(options.allowedSenders),
      authenticate: options.authenticate,
      active: true,
      pending: 0,
    };
    if (!this.releaseGuard) {
      this.releaseGuard = this.host.addPermissionModeGuard((next) => {
        if (next === 'bypassPermissions' && (this.hasActiveSource() || this.pending > 0)) {
          throw new Error('bypassPermissions is unavailable while external event ingress or its turns are active');
        }
      });
    }
    this.sources.set(options.id, state);
    return {
      receive: (raw) => this.receive(state, raw),
      close: () => this.close(state),
    };
  }

  closeAll(): void {
    for (const source of this.sources.values()) this.close(source);
  }

  private hasActiveSource(): boolean {
    for (const source of this.sources.values()) if (source.active) return true;
    return false;
  }

  private close(source: ISourceState): void {
    if (!source.active) return;
    source.active = false;
    this.maybeRelease(source);
  }

  private maybeRelease(source: ISourceState): void {
    if (!source.active && source.pending === 0 && this.sources.get(source.id) === source) {
      this.sources.delete(source.id);
    }
    if (this.sources.size === 0 && this.pending === 0) {
      this.releaseGuard?.();
      this.releaseGuard = undefined;
    }
  }

  private async receive(source: ISourceState, raw: unknown): Promise<IExternalEventReceipt> {
    if (!source.active) return { outcome: 'refused', reason: 'external event source is closed' };
    let event: IAuthenticatedExternalEvent | null;
    try {
      event = await source.authenticate(raw);
    } catch {
      return { outcome: 'refused', reason: 'external event source authentication failed' };
    }
    if (!source.active) return { outcome: 'refused', reason: 'external event source is closed' };
    if (!event || typeof event.senderId !== 'string' || !source.allowedSenders.has(event.senderId)) {
      return { outcome: 'ignored' };
    }
    if (!validIdentity(event.senderId) || !validIdentity(event.conversationId)) {
      return { outcome: 'refused', reason: 'invalid external event identity' };
    }
    if (typeof event.content !== 'string' || Buffer.byteLength(event.content, 'utf8') > MAX_EVENT_BYTES) {
      return { outcome: 'refused', reason: 'external event content exceeds the size limit' };
    }
    const driverId = `external:${source.id}:${encodeURIComponent(event.senderId)}:${encodeURIComponent(event.conversationId)}`;
    const input = `<external-event source="${source.id}" sender="${escapeXml(event.senderId)}" conversation="${escapeXml(event.conversationId)}">\n${escapeXml(event.content)}\n</external-event>`;
    // Hold the guard across submission as well as the completed promise: submit may wait for a turn.
    source.pending += 1;
    this.pending += 1;
    let handle: ITurnHandle;
    try {
      handle = await this.host.submit(input, { turnSource: 'external', driverId });
    } catch {
      source.pending -= 1;
      this.pending -= 1;
      this.maybeRelease(source);
      return { outcome: 'refused', reason: 'session refused external event submission' };
    }
    const settled: Promise<TExternalEventSettlement> = handle.completed.then(
      (result): TExternalEventSettlement => result.interrupted
        ? { outcome: 'interrupted' }
        : { outcome: 'completed', response: result.response },
      (error: unknown): TExternalEventSettlement => isTurnNotRunError(error)
        ? { outcome: 'not-run', reason: error.reason }
        : { outcome: 'failed', reason: 'external event turn failed' },
    ).finally(() => {
      source.pending -= 1;
      this.pending -= 1;
      this.maybeRelease(source);
    });
    return { outcome: 'accepted', turnId: handle.turnId, settled };
  }
}
