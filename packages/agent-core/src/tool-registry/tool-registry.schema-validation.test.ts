import { describe, it, expect } from 'vitest';

import { FunctionTool } from './function-tool';
import { ToolRegistry } from './tool-registry';

import type { IObjectParameterSchema } from '../interfaces/provider';

/**
 * CORE-039 — registration-time schema validation is one of the walks over the subset, so it has to
 * accept every shape the subset can now express.
 *
 * `register()` runs `validateToolSchema` on every tool. It demanded a `type` on each top-level
 * property, which a union node deliberately does not carry — so a tool with a union-typed argument
 * would convert correctly and then be refused at registration: the import-time crash relocated one
 * step further on rather than removed.
 */
function toolWith(parameters: IObjectParameterSchema): FunctionTool {
  return new FunctionTool({ name: 'probe', description: 'probe', parameters }, async () => 'ok');
}

describe('ToolRegistry.register — subset conformance', () => {
  it('accepts a top-level union property, which carries anyOf instead of type', () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.register(
        toolWith({
          type: 'object',
          properties: {
            choice: {
              anyOf: [
                { type: 'string' },
                { type: 'object', properties: { label: { type: 'string' } } },
              ],
            },
          },
        }),
      ),
    ).not.toThrow();
  });

  it('accepts an integer property', () => {
    // `integer` and `null` are members of TJSONSchemaKind that the accepted-type list omitted, so a
    // tool declaring a type the subset itself defines was refused.
    const registry = new ToolRegistry();
    expect(() =>
      registry.register(toolWith({ type: 'object', properties: { count: { type: 'integer' } } })),
    ).not.toThrow();
  });

  it('accepts a null property', () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.register(toolWith({ type: 'object', properties: { nothing: { type: 'null' } } })),
    ).not.toThrow();
  });

  it('still refuses a property that declares neither a type nor anyOf', () => {
    const registry = new ToolRegistry();
    expect(() => registry.register(toolWith({ type: 'object', properties: { odd: {} } }))).toThrow(
      'must have a type',
    );
  });

  it('refuses an empty anyOf rather than treating it as satisfiable', () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.register(toolWith({ type: 'object', properties: { none: { anyOf: [] } } })),
    ).toThrow('empty anyOf');
  });

  it('still refuses an unknown type', () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.register(
        toolWith({
          type: 'object',
          // Deliberately outside TJSONSchemaKind — the boundary cast stands in for a hand-written
          // schema arriving from outside the type system.
          properties: { bad: { type: 'decimal' } as never },
        }),
      ),
    ).toThrow('invalid type');
  });
});
