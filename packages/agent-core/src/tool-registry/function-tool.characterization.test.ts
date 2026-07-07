import { describe, it, expect } from 'vitest';

import { FunctionTool } from './function-tool';
import { ToolRegistry } from './tool-registry';

import type { IToolSchema } from '../interfaces/provider';
import type { TToolParameters } from '../interfaces/tool';

/**
 * DATA-005 characterization tests (RED-first).
 *
 * The core `FunctionTool` (used by the `tool-manager` path) must honor
 * `schema.parameters.additionalProperties`, matching the canonical
 * `additionalProperties`-aware validator relocated from agent-tools:
 *
 *  - `additionalProperties: true`  → extra props ACCEPTED (RED on core today)
 *  - `additionalProperties: { type }` (object form) → extra props type-checked, ACCEPTED when valid
 *  - `additionalProperties: false` / omitted → extra props REJECTED (unchanged guard)
 *
 * Plus the concrete `ToolRegistry` surface the engine relies on.
 */

const baseParams: IToolSchema['parameters'] = {
  type: 'object',
  properties: {
    known: { type: 'string' },
  },
  required: ['known'],
};

function makeTool(parameters: IToolSchema['parameters']): FunctionTool {
  const schema: IToolSchema = {
    name: 'characterize',
    description: 'characterization tool',
    parameters,
  };
  return new FunctionTool(schema, async (p: TToolParameters) => JSON.stringify(p));
}

describe('DATA-005 FunctionTool additionalProperties reconciliation', () => {
  it('ACCEPTS an extra property when additionalProperties === true', async () => {
    const tool = makeTool({ ...baseParams, additionalProperties: true });
    const params: TToolParameters = { known: 'value', extra: 'anything' };

    expect(tool.validate(params)).toBe(true);
    expect(tool.validateParameters(params).isValid).toBe(true);
    await expect(tool.execute(params)).resolves.toMatchObject({ success: true });
  });

  it('ACCEPTS an extra property matching the object-form additionalProperties schema', async () => {
    const tool = makeTool({
      ...baseParams,
      additionalProperties: { type: 'string' },
    });
    const params: TToolParameters = { known: 'value', extra: 'still-a-string' };

    expect(tool.validate(params)).toBe(true);
    expect(tool.validateParameters(params).isValid).toBe(true);
  });

  it('REJECTS an extra property that violates the object-form additionalProperties schema', () => {
    const tool = makeTool({
      ...baseParams,
      additionalProperties: { type: 'number' },
    });
    const params: TToolParameters = { known: 'value', extra: 'not-a-number' };

    expect(tool.validate(params)).toBe(false);
  });

  it('REJECTS an extra property when additionalProperties === false (unchanged guard)', () => {
    const tool = makeTool({ ...baseParams, additionalProperties: false });
    const params: TToolParameters = { known: 'value', extra: 'nope' };

    const result = tool.validateParameters(params);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unknown parameter: extra'))).toBe(true);
  });

  it('REJECTS an extra property when additionalProperties is omitted (unchanged guard)', () => {
    const tool = makeTool({ ...baseParams });
    const params: TToolParameters = { known: 'value', extra: 'nope' };

    const result = tool.validateParameters(params);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unknown parameter: extra'))).toBe(true);
  });

  it('still REJECTS a missing required parameter regardless of additionalProperties', () => {
    const tool = makeTool({ ...baseParams, additionalProperties: true });
    const result = tool.validateParameters({ extra: 'x' } as TToolParameters);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Missing required parameter: known'))).toBe(true);
  });
});

describe('DATA-005 concrete ToolRegistry surface used by the engine', () => {
  function makeRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register(makeTool({ ...baseParams }));
    registry.register(
      makeTool({ ...baseParams }).constructor === FunctionTool
        ? (() => {
            const schema: IToolSchema = {
              name: 'other',
              description: 'other',
              parameters: baseParams,
            };
            return new FunctionTool(schema, async () => 'ok');
          })()
        : makeTool({ ...baseParams }),
    );
    return registry;
  }

  it('exposes size()', () => {
    const registry = makeRegistry();
    expect(registry.size()).toBe(2);
  });

  it('registered FunctionTool exposes getName()', () => {
    const tool = makeTool({ ...baseParams });
    expect(tool.getName()).toBe('characterize');
  });

  it('FunctionTool exposes setEventService()', () => {
    const tool = makeTool({ ...baseParams });
    expect(() => tool.setEventService(undefined)).not.toThrow();
  });

  it('exposes getToolNames()', () => {
    const registry = makeRegistry();
    expect(registry.getToolNames().sort()).toEqual(['characterize', 'other']);
  });

  it('exposes getToolsByPattern()', () => {
    const registry = makeRegistry();
    const matched = registry.getToolsByPattern(/^other$/);
    expect(matched.map((t) => t.schema.name)).toEqual(['other']);
  });
});
