/**
 * NEUT-005 wave 2 — context-capacity hint forwarding.
 *
 * The zero-dependency core emits a product-neutral capacity notice and exposes the
 * `IAgentConfig.contextCapacityHint` seam so a surface tier can inject its own concrete
 * remediation wording (e.g. a `/compact` slash command). This package must thread the
 * session-level `ISessionOptions.contextCapacityHint` option into the Robota agent config so
 * that seam is actually reachable from the consuming layer.
 */

import { describe, expect, it, vi } from 'vitest';

import { buildRobota } from '../session-components.js';

import type { PermissionEnforcer } from '../permission-enforcer.js';
import type { ISessionOptions } from '../session-types.js';
import type {
  IAgentConfig,
  IAIProvider,
  IEventService,
  IToolWithEventService,
} from '@robota-sdk/agent-core';

const capturedConfigs: IAgentConfig[] = [];

vi.mock('@robota-sdk/agent-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-core')>()),
  Robota: vi.fn().mockImplementation((config: IAgentConfig) => {
    capturedConfigs.push(config);
    return { name: config.name };
  }),
}));

const MOCK_PROVIDER = { name: 'mock-provider', version: '1.0.0' } as unknown as IAIProvider;
const MOCK_EVENT_SERVICE = {} as IEventService;
const MOCK_ENFORCER = {
  wrapTools: (tools: IToolWithEventService[]) => tools,
} as unknown as PermissionEnforcer;

function build(options: ISessionOptions): IAgentConfig {
  capturedConfigs.length = 0;
  buildRobota(options, MOCK_ENFORCER, [], MOCK_PROVIDER, 'test-model', 'sys', MOCK_EVENT_SERVICE);
  expect(capturedConfigs).toHaveLength(1);
  return capturedConfigs[0]!;
}

describe('buildRobota — contextCapacityHint forwarding (NEUT-005)', () => {
  it('threads options.contextCapacityHint into the Robota agent config', () => {
    const config = build({ contextCapacityHint: 'Run /compact and retry.' } as ISessionOptions);
    expect(config.contextCapacityHint).toBe('Run /compact and retry.');
  });

  it('omits contextCapacityHint when not provided (core neutral default applies)', () => {
    const config = build({} as ISessionOptions);
    expect(config.contextCapacityHint).toBeUndefined();
  });
});
