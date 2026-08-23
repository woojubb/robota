import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  SESSION_CAPABILITY_MEMBER_KEYS,
  type IInteractiveSession,
  type ISessionCapabilityHost,
  type ISessionCapabilityMap,
  type ISessionEvents,
  type ISessionTurnSubmission,
  type TSessionCapabilityHost,
} from '@robota-sdk/agent-interface-session';
import { createTestInteractiveSession } from '../testing/index.js';
import { createTestSessionCapabilityHost } from '@robota-sdk/agent-interface-session/testing';
// HARNESS-103: the host mechanism moved out of the contract surface. The contracts still come from
// the package entry above; the factory now comes from where doubles live.
import {
  createSessionCapabilityHost,
  readSessionCapability,
} from '@robota-sdk/agent-interface-session/testing';

describe('session capability contracts (ARCH-012)', () => {
  it('keeps the runtime role registry in exact 16-role and 39-member parity', () => {
    type TRegistry = typeof SESSION_CAPABILITY_MEMBER_KEYS;
    type TExactRows = {
      [TKey in keyof ISessionCapabilityMap]:
        | Exclude<keyof ISessionCapabilityMap[TKey], TRegistry[TKey][number]>
        | Exclude<TRegistry[TKey][number], keyof ISessionCapabilityMap[TKey]> extends never
        ? true
        : false;
    };
    const exactRows: TExactRows = {
      lifecycle: true,
      turnSubmission: true,
      turnControl: true,
      goal: true,
      executionState: true,
      driverAttribution: true,
      conversationRead: true,
      identity: true,
      workspaceLocation: true,
      commands: true,
      events: true,
      promptResolution: true,
      backgroundTasks: true,
      backgroundGroups: true,
      executionWorkspace: true,
      agentJobs: true,
    };

    expect(Object.keys(exactRows)).toHaveLength(16);
    expect(Object.values(SESSION_CAPABILITY_MEMBER_KEYS).flat()).toHaveLength(39);
    expect(Object.isFrozen(SESSION_CAPABILITY_MEMBER_KEYS)).toBe(true);
    for (const keys of Object.values(SESSION_CAPABILITY_MEMBER_KEYS)) {
      expect(Object.isFrozen(keys)).toBe(true);
    }
  });

  it('builds an honest subset and distinguishes absent from provided-empty', async () => {
    const submit = vi.fn<IInteractiveSession['submit']>();
    const on = vi.fn<IInteractiveSession['on']>();
    const off = vi.fn<IInteractiveSession['off']>();
    const host = createSessionCapabilityHost({
      turnSubmission: { submit },
      events: { on, off },
    });

    expectTypeOf(host).toMatchTypeOf<
      TSessionCapabilityHost<Pick<ISessionCapabilityMap, 'turnSubmission' | 'events'>>
    >();
    expectTypeOf(host).toMatchTypeOf<ISessionTurnSubmission & ISessionEvents>();
    expect(host.submit).toBe(host.submit);
    expect(host.on).toBe(host.on);
    expect(host.off).toBe(host.off);
    expect(readSessionCapability(host, 'driverAttribution')).toEqual({ provided: false });

    const providedEmpty = createSessionCapabilityHost({
      driverAttribution: { getActiveDriverId: () => null },
    });
    const result = readSessionCapability(providedEmpty, 'driverAttribution');
    expect(result.provided).toBe(true);
    if (result.provided) {
      expect(result.value.getActiveDriverId()).toBeNull();
    }
  });

  it('keeps the canonical capability map authoritative across hostile extra keys', () => {
    const injectedCapabilities = {
      driverAttribution: { getActiveDriverId: () => 'driver-injected' },
    };
    const role = {
      submit: vi.fn<IInteractiveSession['submit']>(),
      capabilities: injectedCapabilities,
      ['__proto__']: { polluted: true as const },
    };

    const capabilities = { turnSubmission: role };
    const host = createSessionCapabilityHost(capabilities);

    expect(host.capabilities).not.toBe(capabilities);
    expect(Object.isFrozen(host.capabilities)).toBe(true);
    expect(readSessionCapability(host, 'turnSubmission')).toEqual({
      provided: true,
      value: role,
    });
    expect(readSessionCapability(host, 'driverAttribution')).toEqual({ provided: false });
    expect(Object.getPrototypeOf(host)).toBeNull();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('owns an immutable map snapshot so flattened and queried roles cannot split', async () => {
    const first = { submit: vi.fn<IInteractiveSession['submit']>() };
    const second = { submit: vi.fn<IInteractiveSession['submit']>() };
    const capabilities: Partial<ISessionCapabilityMap> = { turnSubmission: first };
    const host = createSessionCapabilityHost(capabilities);

    capabilities.turnSubmission = second;

    expect(host.capabilities.turnSubmission).toBe(first);
    expect(readSessionCapability(host, 'turnSubmission')).toEqual({
      provided: true,
      value: first,
    });
    await host.submit('input');
    expect(first.submit).toHaveBeenCalledOnce();
    expect(second.submit).not.toHaveBeenCalled();
  });

  it('reads canonical roles regardless of property enumerability', async () => {
    const submit = vi.fn<IInteractiveSession['submit']>();
    const capabilities: Partial<ISessionCapabilityMap> = {};
    Object.defineProperty(capabilities, 'turnSubmission', {
      enumerable: false,
      value: { submit },
    });

    const host = createSessionCapabilityHost(capabilities);

    await host.submit('input');
    expect(submit).toHaveBeenCalledOnce();
    expect(readSessionCapability(host, 'turnSubmission')).toEqual({
      provided: true,
      value: capabilities.turnSubmission,
    });
  });

  it('treats explicit undefined as absent without collapsing the host type', () => {
    const host = createSessionCapabilityHost({ driverAttribution: undefined });

    expectTypeOf(host).toMatchTypeOf<ISessionCapabilityHost>();
    expectTypeOf(host).not.toHaveProperty('getActiveDriverId');
    expect(readSessionCapability(host, 'driverAttribution')).toEqual({ provided: false });
  });

  it('forwards class methods and accessors with their original receiver', async () => {
    class SubmissionPort implements ISessionTurnSubmission {
      readonly prefix = 'class';
      private accepted = 0;

      get count(): number {
        return this.accepted;
      }

      async submit(
        _input: string,
        _displayInput?: string,
        _rawInput?: string,
      ): ReturnType<IInteractiveSession['submit']> {
        this.accepted += 1;
        return {
          turnId: `${this.prefix}-${this.accepted}`,
          completed: Promise.resolve({
            response: 'ok',
            history: [],
            toolSummaries: [],
            contextState: {
              usedTokens: 0,
              maxTokens: 200000,
              usedPercentage: 0,
              remainingPercentage: 100,
            },
          }),
        };
      }
    }

    const port = new SubmissionPort();
    const host = createSessionCapabilityHost({ turnSubmission: port });
    const submit = host.submit;

    await expect(submit('one')).resolves.toMatchObject({ turnId: 'class-1' });
    await expect(host.submit('two')).resolves.toMatchObject({ turnId: 'class-2' });
    expect(host.submit).toBe(submit);
    expect(port.count).toBe(2);
  });

  it('forwards a canonical prototype accessor with its original receiver', () => {
    const reads = vi.fn();
    class LifecyclePort {
      private initialized = true;

      get isInitialized(): boolean {
        reads();
        return this.initialized;
      }

      async shutdown(): Promise<void> {
        this.initialized = false;
      }
    }

    const port = new LifecyclePort();
    const host = createSessionCapabilityHost({ lifecycle: port });

    expect(reads).not.toHaveBeenCalled();
    expect(host.isInitialized).toBe(true);
    expect(reads).toHaveBeenCalledOnce();
    return expect(host.shutdown())
      .resolves.toBeUndefined()
      .then(() => {
        expect(host.isInitialized).toBe(false);
      });
  });

  it('binds and caches an accessor-backed canonical method', async () => {
    class AccessorSubmissionPort implements ISessionTurnSubmission {
      private accepted = 0;

      get submit(): ISessionTurnSubmission['submit'] {
        return async () => {
          this.accepted += 1;
          return {
            turnId: `accessor-${this.accepted}`,
            completed: Promise.resolve({
              response: 'ok',
              history: [],
              toolSummaries: [],
              contextState: {
                usedTokens: 0,
                maxTokens: 200000,
                usedPercentage: 0,
                remainingPercentage: 100,
              },
            }),
          };
        };
      }
    }

    const port = new AccessorSubmissionPort();
    const host = createSessionCapabilityHost({ turnSubmission: port });
    const submit = host.submit;

    expect(host.submit).toBe(submit);
    await expect(submit('one')).resolves.toMatchObject({ turnId: 'accessor-1' });
    await expect(host.submit('two')).resolves.toMatchObject({ turnId: 'accessor-2' });
  });

  it('fails closed when a claimed role is missing a canonical member', () => {
    const incomplete = { isInitialized: true };

    expect(() =>
      createSessionCapabilityHost({
        // @ts-expect-error — runtime validation must also reject forged callers.
        lifecycle: incomplete,
      }),
    ).toThrow('Missing lifecycle capability member: shutdown');
  });

  it('fails closed on an unknown capability-map key', () => {
    expect(() =>
      createSessionCapabilityHost({
        // @ts-expect-error — runtime validation must also reject forged callers.
        unknownRole: {},
      }),
    ).toThrow('Unknown session capability: unknownRole');
  });

  it('keeps the legacy aggregate shape and publishes full and subset test producers', () => {
    const legacy: IInteractiveSession = createTestInteractiveSession();
    const subset = createTestSessionCapabilityHost({
      driverAttribution: { getActiveDriverId: () => null },
    });

    expect('capabilities' in legacy).toBe(false);
    expect(subset.getActiveDriverId()).toBeNull();
    expect(readSessionCapability(subset, 'driverAttribution')).toEqual({
      provided: true,
      value: subset.capabilities.driverAttribution,
    });
  });
});
