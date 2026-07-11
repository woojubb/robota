/**
 * Transport-neutral pending-prompt registry (REMOTE-007 / B4-2a).
 *
 * A permission decision and an "ask the user" request are no longer served by a single injected
 * callback bound to one surface. Instead the session's event-emitting default handler asks this
 * registry to **park** the awaiting promise under a minted `id`, emit the corresponding session event
 * (`permission_request` / `ask_request`), and let ANY attached surface (local TUI, a WS/WebRTC driver,
 * a web UI) answer via `resolvePermission` / `resolveAsk(id, …)`. The first resolve for an id wins and
 * emits `prompt_resolved` so a co-driving second surface dismisses it; later resolves for a settled id
 * are no-ops.
 *
 * **Fail-closed (D2) — a parked prompt is GUARANTEED to settle:**
 * - at emit: if the gating event has zero listeners, resolve deny / `cancelled` immediately (never park);
 * - on detach: when a surface unsubscribes and the gating event drops to zero listeners, reconcile —
 *   any still-parked prompt of that kind resolves deny / `cancelled` (a disconnect mid-prompt cannot hang);
 * - backstop: an optional bounded timeout is the unconditional last resort (a subscribed surface that
 *   died without unsubscribing). Generous — a human answering never hits it.
 *
 * **Teardown drain (D3):** on abort / cancelQueue / shutdown the session calls {@link drain}, settling
 * every parked prompt (deny permissions, cancel asks) so an aborted turn never leaves the enforcer's
 * `await` — or a wrapped tool — hanging forever.
 *
 * Kept as a standalone class (not folded into the InteractiveSession god-class) so the parking,
 * fail-closed, and drain logic is unit-testable with a stub emitter.
 */

import type { IActionRequest, TActionResponse, TToolArgs } from '@robota-sdk/agent-core';
import type {
  IAskRequestEvent,
  IPermissionRequestEvent,
  IPromptResolvedEvent,
  TDriverId,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-transport';

/** Kind of a parked prompt — decides its fail-closed default and which event gates it. */
type TParkedKind = 'permission' | 'ask';

/** The gating event whose listener count governs each kind (D2 per-event gate). */
type TGatingEvent = 'permission_request' | 'ask_request';

interface IParkedPrompt {
  kind: TParkedKind;
  /** Settle the awaiting promise with a real answer or the fail-closed default. */
  resolve: (value: TPermissionResultValue | TActionResponse) => void;
  /** Backstop timer (cleared on settle), when a backstop is configured. */
  timer?: ReturnType<typeof setTimeout>;
}

/** The fail-closed value for a kind: deny a permission, cancel an ask. */
function failClosedValue(kind: TParkedKind): TPermissionResultValue | TActionResponse {
  return kind === 'permission' ? false : { type: 'cancelled' };
}

const GATING_EVENT: Record<TParkedKind, TGatingEvent> = {
  permission: 'permission_request',
  ask: 'ask_request',
};

export interface ISessionPromptRegistryDeps {
  emitPermissionRequest: (event: IPermissionRequestEvent) => void;
  emitAskRequest: (event: IAskRequestEvent) => void;
  emitPromptResolved: (event: IPromptResolvedEvent) => void;
  /** Live listener count for a gating event (reads the session's per-event emitter map). */
  countListeners: (event: TGatingEvent) => number;
  /** REMOTE-014 E5: the ACTIVE turn's driver id, stamped as `requesterDriverId` on the emitted prompt. */
  getActiveDriverId?: () => TDriverId | null;
  /**
   * Optional backstop timeout (ms). Armed when a prompt parks with a live surface; the unconditional
   * last resort so a surface that died without unsubscribing cannot hang the prompt forever. Omit to
   * disable (unit tests) — emit-time + detach reconciliation already guarantee settlement in every
   * path a live surface participates in.
   */
  backstopMs?: number;
}

export class SessionPromptRegistry {
  private readonly parked = new Map<string, IParkedPrompt>();
  private counter = 0;

  constructor(private readonly deps: ISessionPromptRegistryDeps) {}

  /** Request a permission decision. Resolves deny (`false`) when no surface can answer (fail-closed). */
  requestPermission(toolName: string, toolArgs: TToolArgs): Promise<TPermissionResultValue> {
    const id = this.mintId('p');
    if (this.deps.countListeners('permission_request') === 0) {
      return Promise.resolve(failClosedValue('permission') as TPermissionResultValue);
    }
    const requesterDriverId = this.deps.getActiveDriverId?.() ?? undefined;
    return new Promise<TPermissionResultValue>((resolve) => {
      this.park(id, 'permission', resolve as (v: TPermissionResultValue | TActionResponse) => void);
      this.emitOrFailClosed(id, 'permission', () =>
        this.deps.emitPermissionRequest({
          id,
          toolName,
          toolArgs,
          ...(requesterDriverId ? { requesterDriverId } : {}),
        }),
      );
    });
  }

  /** Request an answer to an ask. Resolves `cancelled` when no surface can answer (fail-closed). */
  requestAsk(request: IActionRequest): Promise<TActionResponse> {
    const id = this.mintId('a');
    if (this.deps.countListeners('ask_request') === 0) {
      return Promise.resolve(failClosedValue('ask') as TActionResponse);
    }
    const requesterDriverId = this.deps.getActiveDriverId?.() ?? undefined;
    return new Promise<TActionResponse>((resolve) => {
      this.park(id, 'ask', resolve as (v: TPermissionResultValue | TActionResponse) => void);
      this.emitOrFailClosed(id, 'ask', () =>
        this.deps.emitAskRequest({
          id,
          request,
          ...(requesterDriverId ? { requesterDriverId } : {}),
        }),
      );
    });
  }

  /** Answer a parked permission by id. `answererDriverId` is server-assigned. Idempotent. */
  resolvePermission(
    id: string,
    result: TPermissionResultValue,
    answererDriverId?: TDriverId,
  ): void {
    if (this.parked.get(id)?.kind !== 'permission') return;
    this.settle(id, result, answererDriverId);
  }

  /** Answer a parked ask by id. `answererDriverId` is server-assigned. Idempotent. */
  resolveAsk(id: string, response: TActionResponse, answererDriverId?: TDriverId): void {
    if (this.parked.get(id)?.kind !== 'ask') return;
    this.settle(id, response, answererDriverId);
  }

  /**
   * Reconcile after a surface unsubscribes (D2): if the gating event dropped to zero listeners, settle
   * every still-parked prompt of that kind fail-closed. Called from the session's `off`.
   */
  reconcileOnDetach(event: TGatingEvent): void {
    if (this.deps.countListeners(event) > 0) return;
    const kind: TParkedKind = event === 'permission_request' ? 'permission' : 'ask';
    for (const [id, parked] of [...this.parked]) {
      if (parked.kind === kind) this.settle(id, failClosedValue(kind));
    }
  }

  /** Teardown drain (D3): settle every parked prompt fail-closed (deny permissions, cancel asks). */
  drain(): void {
    for (const [id, parked] of [...this.parked]) {
      this.settle(id, failClosedValue(parked.kind));
    }
  }

  /** Currently-parked prompt count — for assertions/telemetry. */
  get pendingCount(): number {
    return this.parked.size;
  }

  /**
   * Emit the prompt event, but if a subscribed surface's synchronous handler THROWS, settle the
   * already-parked prompt fail-closed instead of letting the reject propagate out of the Promise
   * executor (which would make the enforcer/tool throw rather than deny, and leak the parked entry
   * until the backstop). Fail-closed is the invariant — a broken surface must not hang or grant.
   */
  private emitOrFailClosed(id: string, kind: TParkedKind, emit: () => void): void {
    try {
      emit();
    } catch {
      this.settle(id, failClosedValue(kind));
    }
  }

  private park(
    id: string,
    kind: TParkedKind,
    resolve: (value: TPermissionResultValue | TActionResponse) => void,
  ): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (this.deps.backstopMs !== undefined) {
      timer = setTimeout(() => this.settle(id, failClosedValue(kind)), this.deps.backstopMs);
      // Never keep the process alive purely to fire a backstop.
      (timer as { unref?: () => void }).unref?.();
    }
    this.parked.set(id, { kind, resolve, timer });
  }

  private settle(
    id: string,
    value: TPermissionResultValue | TActionResponse,
    answererDriverId?: TDriverId,
  ): void {
    const parked = this.parked.get(id);
    if (!parked) return; // unknown or already-settled — idempotent no-op
    this.parked.delete(id);
    if (parked.timer) clearTimeout(parked.timer);
    parked.resolve(value);
    this.deps.emitPromptResolved({ id, ...(answererDriverId ? { answererDriverId } : {}) });
  }

  private mintId(prefix: 'p' | 'a'): string {
    return `${prefix}${++this.counter}`;
  }
}
