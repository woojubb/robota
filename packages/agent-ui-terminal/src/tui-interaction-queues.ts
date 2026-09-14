import type { IPendingPermissionRequest } from './types.js';
import type { IActionRequest, TActionResponse, TToolArgs } from '@robota-sdk/agent-core';
import type { TPermissionResultValue } from '@robota-sdk/agent-interface-session';

interface IUserActionQueueEntry {
  presentedRequest: IActionRequest;
  resolve: (response: TActionResponse) => void;
  id?: string;
}

interface IPermissionQueueEntry {
  toolName: string;
  toolArgs: TToolArgs;
  resolve: (result: TPermissionResultValue) => void;
  id?: string;
}

/** Serializes action prompts and guarantees every pending promise is settled during teardown. */
export class TuiUserActionQueue {
  private entries: IUserActionQueueEntry[] = [];
  private processing = false;

  constructor(private readonly onChange: () => void) {}

  get current(): IActionRequest | null {
    return this.processing ? (this.entries[0]?.presentedRequest ?? null) : null;
  }

  enqueue(request: IActionRequest, id?: string): Promise<TActionResponse> {
    return new Promise<TActionResponse>((resolve) => {
      this.entries.push({
        presentedRequest: { ...request },
        resolve,
        ...(id !== undefined ? { id } : {}),
      });
      this.processNext();
    });
  }

  resolveCurrent(expectedRequest: IActionRequest, response: TActionResponse): void {
    if (this.entries[0]?.presentedRequest !== expectedRequest) return;
    const pending = this.entries.shift();
    if (!pending) return;
    this.processing = false;
    this.onChange();
    pending.resolve(response);
    this.processNext();
  }

  dismissById(id: string): boolean {
    const dismissed = this.entries.filter((entry) => entry.id === id);
    if (dismissed.length === 0) return false;
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.processing = false;
    for (const entry of dismissed) entry.resolve({ type: 'cancelled' });
    this.processNext();
    return true;
  }

  cancelAll(): void {
    const queued = this.entries;
    this.entries = [];
    this.processing = false;
    for (const pending of queued) pending.resolve({ type: 'cancelled' });
    this.onChange();
  }

  private processNext(): void {
    if (this.processing) return;
    if (!this.entries[0]) {
      this.onChange();
      return;
    }
    this.processing = true;
    this.onChange();
  }
}

/** Serializes permission prompts and denies every pending request during teardown. */
export class TuiPermissionQueue {
  private entries: IPermissionQueueEntry[] = [];
  private processing = false;
  private currentRequest: IPendingPermissionRequest | null = null;

  constructor(private readonly onChange: () => void) {}

  get current(): IPendingPermissionRequest | null {
    return this.currentRequest;
  }

  enqueue(toolName: string, toolArgs: TToolArgs, id?: string): Promise<TPermissionResultValue> {
    return new Promise<TPermissionResultValue>((resolve) => {
      this.entries.push({ toolName, toolArgs, resolve, ...(id !== undefined ? { id } : {}) });
      this.processNext();
    });
  }

  dismissById(id: string): boolean {
    const dismissed = this.entries.filter((entry) => entry.id === id);
    if (dismissed.length === 0) return false;
    const dismissedCurrent = this.entries[0]?.id === id;
    this.entries = this.entries.filter((entry) => entry.id !== id);
    for (const entry of dismissed) entry.resolve(false);
    if (dismissedCurrent) {
      this.processing = false;
      this.currentRequest = null;
      this.processNext();
    }
    return true;
  }

  cancelAll(): void {
    const queued = this.entries;
    this.entries = [];
    this.processing = false;
    this.currentRequest = null;
    for (const pending of queued) pending.resolve(false);
    this.onChange();
  }

  private processNext(): void {
    if (this.processing) return;
    const next = this.entries[0];
    if (!next) {
      this.currentRequest = null;
      this.onChange();
      return;
    }
    this.processing = true;
    this.currentRequest = {
      toolName: next.toolName,
      toolArgs: next.toolArgs,
      resolve: (result) => {
        if (this.entries[0] !== next) return;
        this.entries.shift();
        this.processing = false;
        this.currentRequest = null;
        next.resolve(result);
        setTimeout(() => this.processNext(), 0);
      },
    };
    this.onChange();
  }
}
