import { describe, expect, it, vi } from 'vitest';

import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import {
  createOutputStyleCommandEntry,
  executeOutputStyleCommand,
} from '../output-style-command-module.js';

const styles = [
  {
    id: 'default',
    name: 'Default',
    description: 'Balanced responses.',
    tokenCost: 'baseline',
    source: 'built-in',
  },
  {
    id: 'concise',
    name: 'Concise',
    description: 'Lead with the answer.',
    tokenCost: 'low',
    source: 'built-in',
  },
] as const;

function context() {
  const ask = vi.fn().mockResolvedValue({ type: 'answer', values: ['concise'] });
  const host = createTestCommandHost({
    overrides: {
      getActiveOutputStyleId: () => 'default',
      getUserInteraction: () => ({ ask }),
      getCommandHostAdapters: () => ({
        outputStyleRegistry: {
          listOutputStyles: () => styles,
          getOutputStyle: (id) =>
            id === 'concise'
              ? {
                  id: 'concise',
                  name: 'Concise',
                  instructions: 'Lead with the answer.',
                  keepCodingInstructions: true,
                  tokenCost: 'low',
                }
              : undefined,
        },
      }),
    },
  });
  return { host, ask };
}

describe('/output-style', () => {
  it('lists styles with the active marker and token-cost metadata', async () => {
    const { host } = context();
    const result = await executeOutputStyleCommand(host, 'list');

    expect(result.success).toBe(true);
    expect(result.message).toContain(
      '* default — Default: Balanced responses. [input cost: baseline]',
    );
    expect(result.message).toContain(
      '  concise — Concise: Lead with the answer. [input cost: low]',
    );
    expect(result.data).toEqual({ outputStyles: styles, active: 'default' });
  });

  it('uses the inline picker when no id is supplied and emits only a style id action', async () => {
    const { host, ask } = context();
    const result = await executeOutputStyleCommand(host, '');

    expect(ask).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      success: true,
      hostActions: [{ type: 'output-style-change', styleId: 'concise' }],
      data: { outputStyle: 'concise' },
    });
  });

  it('rejects unknown ids and never emits an action', async () => {
    const { host } = context();
    const result = await executeOutputStyleCommand(host, 'missing');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown output style');
    expect(result.hostActions).toBeUndefined();
  });

  it('is operator-only', () => {
    expect(createOutputStyleCommandEntry()).toMatchObject({
      name: 'output-style',
      modelInvocable: false,
      userInvocable: true,
    });
  });
});
