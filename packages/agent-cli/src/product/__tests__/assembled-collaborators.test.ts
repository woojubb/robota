import { describe, expect, it } from 'vitest';

import { bindAssembledCollaborators } from '../assembled-collaborators.js';

import type { IAssembledProduct } from '@robota-sdk/agent-product';

/**
 * CLI-078 (issue #2443): the modes bind to the collaborator identity ASSEMBLY returned.
 */
type TFactory = NonNullable<IAssembledProduct['subagentRunnerFactory']>;
const factory = (() => ({}) as never) as TFactory;
const runner = { kind: 'agent' } as unknown as IAssembledProduct['backgroundTaskRunners'][number];

describe('bindAssembledCollaborators', () => {
  it('returns the assembled identities when the fold passed the inputs through', () => {
    const product = { backgroundTaskRunners: [runner], subagentRunnerFactory: factory };
    const bound = bindAssembledCollaborators(product, {
      backgroundTaskRunners: [runner],
      subagentRunnerFactory: factory,
    });
    expect(bound.subagentRunnerFactory).toBe(factory);
    expect(bound.backgroundTaskRunners).toBe(product.backgroundTaskRunners);
  });

  it('refuses a fold that substituted the subagent runner factory', () => {
    const other = (() => ({}) as never) as TFactory;
    expect(() =>
      bindAssembledCollaborators(
        { backgroundTaskRunners: [runner], subagentRunnerFactory: other },
        { backgroundTaskRunners: [runner], subagentRunnerFactory: factory },
      ),
    ).toThrow(/subagent runner factory other than/);
  });

  it('refuses a fold that dropped or replaced a background task runner', () => {
    expect(() =>
      bindAssembledCollaborators(
        { backgroundTaskRunners: [], subagentRunnerFactory: factory },
        { backgroundTaskRunners: [runner], subagentRunnerFactory: factory },
      ),
    ).toThrow(/background task runners other than/);
  });
});
