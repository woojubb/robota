import { z } from 'zod';
import {
  buildValidationError,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import { AbstractNodeDefinition } from './abstract-node-definition.js';
import { NodeIoAccessor } from './node-io-accessor.js';

export interface DefineDagNodeOptions<
  TSchema extends z.ZodTypeAny = z.ZodObject<Record<string, never>>,
> {
  /** Unique node type identifier. Must be kebab-case. */
  nodeType: string;
  displayName?: string;
  category?: string;
  /** Defaults to the first input port key. */
  defaultInputPort?: string;
  /** Defaults to the first output port key. */
  defaultOutputPort?: string;
  inputs: IDagNodeDefinition['inputs'];
  outputs: IDagNodeDefinition['outputs'];
  /** Optional Zod schema for config validation. Defaults to z.object({}). */
  configSchema?: TSchema;
  /**
   * Optional cost estimator. Return the number of credits this node will use.
   */
  estimateCreditCost?: (
    inputs: Record<string, unknown>,
    config: z.output<TSchema>,
  ) => number | Promise<number>;
  /**
   * Node execution logic. Receives port inputs as a plain Record and the parsed config.
   * Return a Record whose keys match the declared output port keys.
   * Throw an Error to signal failure — it will be converted to an IDagError.
   */
  execute: (
    inputs: Record<string, unknown>,
    config: z.output<TSchema>,
    context: INodeExecutionContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

/**
 * Factory that creates a DAG node class from a plain configuration object.
 *
 * Eliminates the need to subclass AbstractNodeDefinition directly.
 * The returned class can be instantiated (new NodeClass()) and registered
 * in any node registry.
 *
 * @example
 * ```typescript
 * // upper-case.dag.node.ts
 * import { defineDagNode } from '@robota-sdk/dag-node';
 *
 * export default defineDagNode({
 *   nodeType: 'upper-case',
 *   inputs:  [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
 *   outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
 *   execute: async ({ text }) => ({ text: String(text).toUpperCase() }),
 * });
 * ```
 */
export function defineDagNode<TSchema extends z.ZodTypeAny = z.ZodObject<Record<string, never>>>(
  options: DefineDagNodeOptions<TSchema>,
): new () => IDagNodeDefinition {
  const resolvedSchema = (options.configSchema ?? z.object({})) as TSchema;
  const resolvedDefaultInputPort = options.defaultInputPort ?? options.inputs[0]?.key;
  const resolvedDefaultOutputPort = options.defaultOutputPort ?? options.outputs[0]?.key;
  const resolvedDisplayName = options.displayName ?? options.nodeType;

  return class DefinedDagNode extends AbstractNodeDefinition<TSchema> {
    public readonly nodeType = options.nodeType;
    public readonly displayName = resolvedDisplayName;
    public readonly category = options.category ?? 'Custom';
    public override readonly defaultInputPort = resolvedDefaultInputPort;
    public override readonly defaultOutputPort = resolvedDefaultOutputPort;
    public readonly inputs = options.inputs;
    public readonly outputs = options.outputs;
    public readonly configSchemaDefinition = resolvedSchema;

    public override async estimateCostWithConfig(
      input: TPortPayload,
      context: INodeExecutionContext,
      config: z.output<TSchema>,
    ): Promise<TResult<ICostEstimate, IDagError>> {
      if (!options.estimateCreditCost) {
        return { ok: true, value: { estimatedCredits: 0 } };
      }
      const inputs = extractInputRecord(input, options.inputs);
      const credits = await Promise.resolve(options.estimateCreditCost(inputs, config));
      return { ok: true, value: { estimatedCredits: credits } };
    }

    protected override async executeWithConfig(
      input: TPortPayload,
      context: INodeExecutionContext,
      config: z.output<TSchema>,
    ): Promise<TResult<TPortPayload, IDagError>> {
      const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
      const inputs = extractInputRecord(input, options.inputs);

      let outputRecord: Record<string, unknown>;
      try {
        outputRecord = await Promise.resolve(options.execute(inputs, config, context));
      } catch (err) {
        // allow-fallback: user execute() throws are surfaced as IDagError, not silently dropped
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: buildValidationError(
            'DAG_NODE_EXECUTE_ERROR',
            `Node '${options.nodeType}' execute threw an error: ${message}`,
            { nodeId: context.nodeDefinition.nodeId, nodeType: options.nodeType },
          ),
        };
      }

      for (const [key, value] of Object.entries(outputRecord)) {
        io.setOutput(key, value as Parameters<NodeIoAccessor['setOutput']>[1]);
      }

      if (!('_agentSummary' in outputRecord)) {
        const firstKey = options.outputs[0]?.key;
        const firstValue = firstKey !== undefined ? outputRecord[firstKey] : undefined;
        const summary =
          typeof firstValue === 'string'
            ? `${resolvedDisplayName}: ${firstValue.slice(0, 120)}`
            : `${resolvedDisplayName} completed.`;
        io.setOutput('_agentSummary', summary);
      }

      return { ok: true, value: io.toOutput() };
    }
  };
}

function extractInputRecord(
  payload: TPortPayload,
  portDefs: IDagNodeDefinition['inputs'],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const port of portDefs) {
    const value = payload[port.key];
    if (value !== undefined) {
      result[port.key] = value;
    }
  }
  return result;
}
