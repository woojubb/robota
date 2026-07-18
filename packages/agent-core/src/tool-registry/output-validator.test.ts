import { describe, it, expect } from 'vitest';

import { FunctionTool } from './function-tool';
import { ToolExecutionError } from '../utils/errors';

import type { IToolSchema } from '../interfaces/provider';
import type { TUniversalValue } from '../interfaces/types';

/**
 * SELFHOST-005 TC-03 — tool OUTPUT schema validation in agent-core tool-registry.
 *
 * When a tool declares an `outputSchema`, `FunctionTool.execute` validates the returned value against
 * it and throws `ToolExecutionError` on mismatch (same layer as tool-input validation). Absent =
 * unchanged. Model-output validation (CORE-015) is separate and out of scope.
 */

const OUTPUT_SCHEMA: IToolSchema['outputSchema'] = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    count: { type: 'number' },
  },
  required: ['status', 'count'],
};

function makeTool(
  fn: (p: unknown) => TUniversalValue | Promise<TUniversalValue>,
  withSchema = true,
): FunctionTool {
  const schema: IToolSchema = {
    name: 'reporter',
    description: 'reports',
    parameters: { type: 'object', properties: {}, required: [] },
    ...(withSchema ? { outputSchema: OUTPUT_SCHEMA } : {}),
  };
  return new FunctionTool(schema, async (p) => fn(p));
}

describe('SELFHOST-005 TC-03 — tool-output schema validation', () => {
  it('accepts an output that matches the declared outputSchema', async () => {
    const tool = makeTool(() => ({ status: 'ok', count: 3 }));
    await expect(tool.execute({})).resolves.toMatchObject({
      success: true,
      data: { status: 'ok', count: 3 },
    });
  });

  it('throws ToolExecutionError when the output violates the schema (missing required field)', async () => {
    const tool = makeTool(() => ({ status: 'ok' })); // missing count
    await expect(tool.execute({})).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('throws when a field has the wrong type', async () => {
    const tool = makeTool(() => ({ status: 'ok', count: 'three' })); // count must be number
    await expect(tool.execute({})).rejects.toThrow(/outputSchema/i);
  });

  it('does not validate output when no outputSchema is declared (backward-compatible)', async () => {
    const tool = makeTool(() => ({ anything: true }), false);
    await expect(tool.execute({})).resolves.toMatchObject({ success: true });
  });
});
