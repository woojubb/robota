/** Per-call admission at the HTTP carrier's final handoff, after authentication. */
import { toolsCallRequestId } from './trace-propagation.js';

import type { TMCPDispatchAdmission } from './session-types.js';

interface IAdmission {
  readonly admit: TMCPDispatchAdmission;
  id?: string | number;
  started: boolean;
  closed: boolean;
  sent: boolean;
}

export class MCPDispatchAdmissions {
  private pending: IAdmission | undefined;
  private unbound = false;
  private readonly calls = new Map<string | number, IAdmission>();

  /** The SDK invokes transport.send synchronously while it starts a request. */
  run<T>(admit: TMCPDispatchAdmission, start: () => Promise<T>): Promise<T> {
    if (this.unbound) throw new Error('The transport has an unbound tool dispatch');
    if (this.pending !== undefined) throw new Error('A tool dispatch is already being prepared');
    const entry: IAdmission = { admit, started: false, closed: false, sent: false };
    this.pending = entry;
    let handedOff = false;
    try {
      const response = start();
      if (entry.id === undefined) {
        // A later SDK send must not escape after this admission has already failed.
        this.unbound = true;
        void response.catch(() => undefined);
        throw new Error('The transport did not bind the tool dispatch');
      }
      handedOff = true;
      return response.finally(() => {
        entry.closed = true;
        this.cleanup(entry);
      });
    } finally {
      this.pending = undefined;
      if (!handedOff) {
        entry.closed = true;
        this.cleanup(entry);
      }
    }
  }

  /** Bind the next synchronous tools/call to its JSON-RPC id, before the carrier sees it. */
  attach(message: unknown): string | number | undefined {
    if (this.pending === undefined) {
      if (this.unbound && toolsCallRequestId(message) !== undefined)
        throw new Error('The transport has an unbound tool dispatch');
      return undefined;
    }
    const id = toolsCallRequestId(message);
    if (id === undefined || this.pending.id !== undefined || this.calls.has(id))
      throw new Error('The tool dispatch could not be bound');
    this.pending.id = id;
    this.calls.set(id, this.pending);
    return id;
  }

  sent(id: string | number): void {
    const entry = this.calls.get(id);
    if (entry === undefined) return;
    entry.sent = true;
    this.cleanup(entry);
  }

  private cleanup(entry: IAdmission): void {
    if (entry.id !== undefined && entry.closed && entry.sent) this.calls.delete(entry.id);
  }

  /** Calls without an admission use the existing path. An admitted call never sends twice. */
  async send(
    message: unknown,
    send: () => Promise<Response>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const id = toolsCallRequestId(message);
    const entry = id === undefined ? undefined : this.calls.get(id);
    if (entry === undefined) return send();
    const params = (message as { params?: unknown }).params;
    if (typeof params !== 'object' || params === null || Array.isArray(params))
      throw new Error('The tool request cannot be inspected');
    const { name, arguments: args = {} } = params as { name?: unknown; arguments?: unknown };
    if (
      typeof name !== 'string' ||
      typeof args !== 'object' ||
      args === null ||
      Array.isArray(args)
    )
      throw new Error('The tool request cannot be inspected');
    const request = Object.freeze({ tool: name, argumentsJson: JSON.stringify(args) });
    let open = true;
    let response: Promise<Response> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      if (entry.closed || signal?.aborted) throw new Error('The tool request was cancelled');
      if (entry.started) throw new Error('The tool request was already dispatched');
      const admission = entry.admit(() => {
        if (!open || entry.closed || entry.started || response !== undefined)
          throw new Error('The tool request was already dispatched');
        if (signal?.aborted) throw new Error('The tool request was cancelled');
        entry.started = true;
        response = send();
        // Admission may still be releasing its lock when the network fails.
        void response.catch(() => undefined);
        return response;
      }, request);
      const admitted =
        signal === undefined
          ? await admission
          : await Promise.race([
              admission,
              new Promise<never>((_resolve, reject) => {
                onAbort = () => reject(new Error('The tool request was cancelled'));
                signal.addEventListener('abort', onAbort, { once: true });
                if (signal.aborted) onAbort();
              }),
            ]);
      if (response === undefined || admitted.response !== response)
        throw new Error('The tool request was not admitted');
    } catch (error) {
      // An error after dispatch cannot establish whether the service acted.
      void response?.catch(() => undefined);
      throw error;
    } finally {
      open = false;
      if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
    }
    return response;
  }

  clear(): void {
    for (const entry of this.calls.values()) entry.closed = true;
  }
}

const admissions = new WeakMap<object, MCPDispatchAdmissions>();

export function bindDispatchAdmissions(transport: object, guard: MCPDispatchAdmissions): void {
  admissions.set(transport, guard);
}

/** A transport without a final-handoff guard cannot execute an admitted action. */
export function withDispatchAdmission<T>(
  transport: object,
  admit: TMCPDispatchAdmission,
  start: () => Promise<T>,
): Promise<T> {
  const guard = admissions.get(transport);
  if (guard === undefined) throw new Error('This transport cannot admit a tool dispatch');
  return guard.run(admit, start);
}
