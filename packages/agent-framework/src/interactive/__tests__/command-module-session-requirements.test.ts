import { describe, expect, it } from 'vitest';

import { buildCreateSessionOptions } from '../create-session-projection.js';

import type { ICommandModule } from '../../command-api/command-module.js';
import type { ICreateSessionProjectionDeps } from '../create-session-projection.js';
import type { IInitOptions } from '../interactive-session-options.js';

/**
 * CMD-008: `sessionRequirements` is a demand switch. A composed module that declares
 * `'agent-runtime'` makes the projection enable the runtime; without such a module the key stays
 * absent (a conditional spread, never `enableAgentRuntime: undefined`).
 */
const DEPS: ICreateSessionProjectionDeps = {
  mergedConfig: { provider: { name: 'test', model: 'test-model' } } as never,
  cwd: '/cmd-008',
  context: {} as ICreateSessionProjectionDeps['context'],
  projectInfo: {} as ICreateSessionProjectionDeps['projectInfo'],
  sessionId: 'test-session',
  contextCapacityHint: undefined,
  contributionSources: [],
};

function initOptions(extra: Partial<IInitOptions>): IInitOptions {
  return { cwd: '/cmd-008', provider: {} as never, ...extra } as IInitOptions;
}

describe('CMD-008 — sessionRequirements is a demand switch', () => {
  it('enables the agent runtime when a composed module declares agent-runtime', () => {
    const demanding: ICommandModule = { name: 'demanding', sessionRequirements: ['agent-runtime'] };

    const built = buildCreateSessionOptions(initOptions({ commandModules: [demanding] }), DEPS);

    expect(built.enableAgentRuntime).toBe(true);
  });

  it('leaves the key absent when no composed module declares a requirement', () => {
    const plain: ICommandModule = { name: 'plain' };

    const built = buildCreateSessionOptions(initOptions({ commandModules: [plain] }), DEPS);

    expect('enableAgentRuntime' in built).toBe(false);
  });
});
