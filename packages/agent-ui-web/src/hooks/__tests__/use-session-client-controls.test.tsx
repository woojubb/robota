// @vitest-environment jsdom
/**
 * #3282 §2 (part 2) — the GUI reducer's support for the model/mode/effort pop-up menus:
 *
 * - `requestModelList()` sends `list-models` with a fresh `requestId`, and only a reply carrying
 *   THAT id is applied to `modelList` — a reply to a superseded request is dropped.
 * - `sendCommandSilently(name, args)` runs the same `command` wire message `send` does, but its
 *   `command_result` never becomes a conversation card: a successful change confirms itself through
 *   the control's own label (fed by the `get-status` refresh every `command_result` already
 *   triggers), and a failed one becomes a plain notice instead, leaving the label unchanged. A command
 *   sent through the ordinary `send` (what a typed `/command` uses) keeps its card either way.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

afterEach(() => window.sessionStorage.clear());

function setup(): {
  result: { current: ReturnType<typeof useSessionClient> };
  deliver: (msg: TServerMessage) => void;
  connect: () => void;
  wire: TClientMessage[];
} {
  let onMessage: ((msg: TServerMessage) => void) | null = null;
  let onStatusChange: ((status: 'connected') => void) | null = null;
  const wire: TClientMessage[] = [];
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    onStatusChange = callbacks.onStatusChange;
    return { connect: () => {}, disconnect: () => {}, send: (message) => wire.push(message) };
  };
  const { result } = renderHook(() => useSessionClient(makeClient));
  return {
    result,
    wire,
    deliver: (msg) => act(() => onMessage?.(msg)),
    connect: () => act(() => onStatusChange?.('connected')),
  };
}

const MODEL_LIST_SNAPSHOT = {
  groups: [
    {
      profileName: 'anthropic',
      providerLabel: 'Anthropic',
      models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }],
    },
  ],
  currentProfile: 'anthropic',
  currentModel: 'claude-sonnet-4-6',
};

describe('#3282 §2 (part 2) — requestModelList / modelList', () => {
  it('sends list-models and stores the reply under modelList', () => {
    const { result, deliver, wire } = setup();

    act(() => result.current.requestModelList());
    const request = wire.find((m) => m.type === 'list-models');
    expect(request?.type).toBe('list-models');
    expect(result.current.modelList).toBeNull();

    deliver({
      type: 'model_list',
      requestId: request && request.type === 'list-models' ? request.requestId : '',
      ...MODEL_LIST_SNAPSHOT,
    });

    expect(result.current.modelList).toEqual(MODEL_LIST_SNAPSHOT);
  });

  it('ignores a reply to a request a newer one already superseded', () => {
    const { result, deliver, wire } = setup();

    act(() => result.current.requestModelList());
    const first = wire.find((m) => m.type === 'list-models');
    act(() => result.current.requestModelList());

    deliver({
      type: 'model_list',
      requestId: first && first.type === 'list-models' ? first.requestId : '',
      ...MODEL_LIST_SNAPSHOT,
      currentModel: 'stale-reply-must-not-apply',
    });

    expect(result.current.modelList).toBeNull();
  });
});

/** The `requestId` a `sendCommandSilently`/`send({type:'command',...})` call most recently put on the wire. */
function lastSentRequestId(wire: TClientMessage[]): string | undefined {
  const sent = wire[wire.length - 1];
  return sent && sent.type === 'command' ? sent.requestId : undefined;
}

describe('#3282 §2 (part 2) — sendCommandSilently suppresses the conversation card', () => {
  it('a successful silent command adds no conversation card, but still refreshes status', () => {
    const { result, deliver, wire } = setup();

    act(() => result.current.sendCommandSilently('model', 'claude-haiku-4-5'));
    expect(wire).toContainEqual(
      expect.objectContaining({ type: 'command', name: 'model', args: 'claude-haiku-4-5' }),
    );
    const requestId = lastSentRequestId(wire);
    expect(requestId).toBeDefined();

    deliver({ type: 'command_result', name: 'model', message: 'Model: Claude Haiku 4.5', success: true, requestId });

    expect(result.current.messages.some((m) => m.role === 'command')).toBe(false);
    expect(wire.filter((m) => m.type === 'get-status')).toHaveLength(1);
  });

  it('a failed silent command adds no card either, but raises a plain notice', () => {
    const { result, deliver, wire } = setup();

    act(() => result.current.sendCommandSilently('mode', 'bypassPermissions'));
    const requestId = lastSentRequestId(wire);

    deliver({ type: 'command_result', name: 'mode', message: 'Could not change mode.', success: false, requestId });

    expect(result.current.messages.some((m) => m.role === 'command')).toBe(false);
    expect(result.current.sessionNotices.map((n) => n.message)).toContain('Could not change mode.');
  });

  it('a command sent the ordinary way (a typed /command) still gets its card', () => {
    const { result, deliver } = setup();

    act(() => result.current.send({ type: 'command', name: 'mode', args: 'plan' }));
    deliver({ type: 'command_result', name: 'mode', message: 'Permission mode set to: plan', success: true });

    const card = result.current.messages.find((m) => m.role === 'command');
    expect(card).toBeDefined();
    expect(card && 'content' in card ? card.content : undefined).toBe('Permission mode set to: plan');
  });

  it('silent and typed commands resolved one after the other are each attributed correctly', () => {
    const { result, deliver, wire } = setup();

    act(() => result.current.sendCommandSilently('effort', 'high'));
    deliver({ type: 'command_result', name: 'effort', message: 'Effort: High', success: true, requestId: lastSentRequestId(wire) });
    act(() => result.current.send({ type: 'command', name: 'help' }));
    deliver({ type: 'command_result', name: 'help', message: 'Available commands: ...', success: true });

    const cards = result.current.messages.filter((m) => m.role === 'command');
    expect(cards).toHaveLength(1);
    expect(cards[0] && 'name' in cards[0] ? cards[0].name : undefined).toBe('help');
  });

  it('attributes by requestId, not arrival order: a later-sent silent reply landing FIRST does not swallow the earlier typed command', () => {
    // Reviewer-mandated regression test (#3339): a send-order-based FIFO was tried first and is
    // exactly as wrong as a bare count — both assume replies arrive in send order, which a slow host
    // or a race can violate. The wire already correlates a `command` with its `command_result` by
    // `requestId` (`packages/agent-transport/src/wire-messages.ts`), so attribution must use THAT,
    // never position. Proof: send the typed command first, the silent one second, but deliver the
    // SILENT one's reply first — the reverse of send order. A FIFO shifts its front (the typed
    // command's `false` entry) for this first-arriving reply, misreading the silent reply as
    // non-silent (wrongly gives it a card) and the later typed reply as silent (wrongly swallows its
    // card). requestId correlation gets both right regardless of arrival order.
    const { result, deliver, wire } = setup();

    act(() => result.current.send({ type: 'command', name: 'help' }));
    act(() => result.current.sendCommandSilently('effort', 'high'));
    const silentRequestId = lastSentRequestId(wire);
    expect(silentRequestId).toBeDefined();

    deliver({ type: 'command_result', name: 'effort', message: 'Effort: High', success: true, requestId: silentRequestId });
    deliver({ type: 'command_result', name: 'help', message: 'Available commands: ...', success: true });

    const cards = result.current.messages.filter((m) => m.role === 'command');
    expect(cards).toHaveLength(1);
    expect(cards[0] && 'name' in cards[0] ? cards[0].name : undefined).toBe('help');
  });

  it('a silent command whose reply carries no requestId (an older host) falls back to showing the card, never hiding it', () => {
    // Silence is opt-in per identified reply, never the default: a `command_result` this surface
    // cannot positively match to a silent request must show its card. The alternative — hiding the
    // outcome of a reply that might, for all this surface can tell, belong to something the person
    // typed — is the worse failure mode.
    const { result, deliver } = setup();

    act(() => result.current.sendCommandSilently('effort', 'high'));
    deliver({ type: 'command_result', name: 'effort', message: 'Effort: High', success: true });

    const card = result.current.messages.find((m) => m.role === 'command');
    expect(card).toBeDefined();
  });
});
