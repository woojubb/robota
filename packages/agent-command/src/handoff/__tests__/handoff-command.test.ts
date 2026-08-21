/**
 * `/handoff` (HANDOFF-001, issue #1864) — the consent, and the sentence the operator needs.
 *
 * Two properties are asserted on nearly every path, because they are what the command is for:
 *
 *   the prompt names what will be LOST before it asks, and
 *   every outcome says where the session is now.
 *
 * A hand-off is irreversible from the source's side. A confirmation that did not mention the
 * uncommitted work is not consent to lose it, and an outcome that did not say where the session
 * went leaves the operator not knowing which computer to walk to.
 */

import type {
  ICommandHostAdapters,
  IHandoffProgress,
  IHandoffStaysBehind,
} from '@robota-sdk/agent-framework';
import type { IActionRequest, TActionResponse } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { executeHandoffCommand } from '../handoff-command.js';

const HERE: IHandoffProgress = { state: 'offered', stillMine: true };

interface IHarness {
  readonly destinations?: readonly { readonly deviceId: string; readonly name?: string }[];
  readonly staysBehind?: IHandoffStaysBehind;
  readonly transfer?: (
    deviceId: string,
    onProgress?: (progress: IHandoffProgress) => void,
  ) => Promise<IHandoffProgress>;
  readonly answer?: TActionResponse;
  /** Omitted entirely when the host has no interactive renderer — that is a case, not a default. */
  readonly interactive?: boolean;
  readonly adapter?: boolean;
}

function host(harness: IHarness = {}) {
  const asked: IActionRequest[] = [];
  const adapters: ICommandHostAdapters =
    harness.adapter === false
      ? {}
      : {
          handoff: {
            destinations: async () => harness.destinations ?? [{ deviceId: 'laptop' }],
            staysBehind: async () =>
              harness.staysBehind ?? { uncommittedChanges: false, subprocesses: 0 },
            transfer:
              harness.transfer ??
              (async (_id, onProgress) => {
                onProgress?.({ state: 'sending', stillMine: true });
                return { state: 'done', stillMine: false };
              }),
            status: () => HERE,
          },
        };
  return {
    asked,
    context: {
      getCommandHostAdapters: () => adapters,
      getUserInteraction:
        harness.interactive === false
          ? () => undefined
          : () => ({
              ask: async (request: IActionRequest): Promise<TActionResponse> => {
                asked.push(request);
                return harness.answer ?? { type: 'answer', values: ['move'] };
              },
            }),
    },
  };
}

describe('the consent names what will be lost, before it asks', () => {
  it('says the uncommitted work and the running processes stay behind', async () => {
    const { asked, context } = host({
      staysBehind: { uncommittedChanges: true, subprocesses: 3 },
    });
    await executeHandoffCommand(context, 'laptop');

    expect(asked).toHaveLength(1);
    const description = asked[0]?.description ?? '';
    expect(description).toContain('uncommitted changes');
    expect(description).toContain('3 running process');
    // The credential line is unconditional: it is true on every hand-off, and it is the one that
    // explains why the other machine may refuse at the last step.
    expect(description).toContain('credentials are never transferred');
  });

  it('omits what does not apply, so the prompt is not a standing warning nobody reads', async () => {
    const { asked, context } = host({
      staysBehind: { uncommittedChanges: false, subprocesses: 0 },
    });
    await executeHandoffCommand(context, 'laptop');

    const description = asked[0]?.description ?? '';
    expect(description).not.toContain('uncommitted changes');
    expect(description).not.toContain('running process');
    expect(description).toContain('credentials are never transferred');
  });

  it('does not transfer when the operator declines', async () => {
    const transfer = vi.fn();
    const { context } = host({ answer: { type: 'answer', values: ['stay'] }, transfer });
    const result = await executeHandoffCommand(context, 'laptop');

    expect(transfer).not.toHaveBeenCalled();
    expect(result.message).toContain('still on this machine');
  });

  it('treats a dismissed prompt as a decline, never as a yes', async () => {
    const transfer = vi.fn();
    const { context } = host({ answer: { type: 'cancelled' }, transfer });
    const result = await executeHandoffCommand(context, 'laptop');

    expect(transfer).not.toHaveBeenCalled();
    expect(result.message).toContain('still on this machine');
  });

  it('refuses when no human is attached, rather than proceeding unasked', async () => {
    const transfer = vi.fn();
    const { context } = host({ interactive: false, transfer });
    const result = await executeHandoffCommand(context, 'laptop');

    expect(result.success).toBe(false);
    expect(transfer).not.toHaveBeenCalled();
    expect(result.message).toContain('needs a person to confirm');
    expect(result.message).toContain('still on this machine');
  });
});

describe('every outcome says where the session is now', () => {
  it('says the destination owns it when the transfer completes', async () => {
    const { context } = host({
      transfer: async () => ({ state: 'done', stillMine: false }),
    });
    const result = await executeHandoffCommand(context, 'laptop');

    expect(result.success).toBe(true);
    expect(result.message).toContain('laptop is running this session now');
    expect(result.message).toContain('read-only');
  });

  it('says the session is still here when the transfer stops, and why', async () => {
    const { context } = host({
      transfer: async () => ({
        state: 'stopped',
        reason: 'the destination resolved no provider credential',
        stillMine: true,
      }),
    });
    const result = await executeHandoffCommand(context, 'laptop');

    expect(result.success).toBe(false);
    expect(result.message).toContain('no provider credential');
    expect(result.message).toContain('still on this machine');
    expect(result.message).not.toContain('read-only');
  });

  it('names the waiting phase as safe to leave, since that is when it looks stuck', async () => {
    const { context } = host({
      transfer: async (_id, onProgress) => {
        onProgress?.({ state: 'awaiting-confirmation', stillMine: true });
        return { state: 'done', stillMine: false };
      },
    });
    const result = await executeHandoffCommand(context, 'laptop');

    expect(result.message).toContain('this machine keeps it');
  });
});

describe('what it refuses before asking anything', () => {
  it('says a host with no carrier cannot move a session', async () => {
    const { asked, context } = host({ adapter: false });
    const result = await executeHandoffCommand(context, 'laptop');

    expect(result.success).toBe(false);
    expect(asked).toHaveLength(0);
    expect(result.message).toContain('no hand-off carrier');
    expect(result.message).toContain('still here');
  });

  it('refuses a destination that is not reachable, and lists the ones that are', async () => {
    const { asked, context } = host({
      destinations: [{ deviceId: 'laptop', name: 'Work laptop' }],
    });
    const result = await executeHandoffCommand(context, 'tablet');

    expect(result.success).toBe(false);
    expect(asked).toHaveLength(0);
    expect(result.message).toContain("No reachable machine is called 'tablet'");
    expect(result.message).toContain('Work laptop');
    expect(result.message).toContain('still on this machine');
  });

  it('lists the destinations when called with no argument', async () => {
    const { asked, context } = host({
      destinations: [{ deviceId: 'laptop' }, { deviceId: 'tablet' }],
    });
    const result = await executeHandoffCommand(context, '');

    expect(asked).toHaveLength(0);
    expect(result.success).toBe(true);
    expect(result.message).toContain('laptop');
    expect(result.message).toContain('tablet');
  });

  it('says so plainly when nothing is reachable', async () => {
    const { context } = host({ destinations: [] });
    const result = await executeHandoffCommand(context, '');

    expect(result.success).toBe(true);
    expect(result.message).toContain('No other machine is reachable');
    expect(result.message).toContain('still on this machine');
  });
});
