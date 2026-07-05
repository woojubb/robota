import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const MultiInputConfigSchema = z.object({
  ports: z.array(z.string()).default([]),
  values: z.record(z.string()).default({}),
});

/**
 * DAG node that emits multiple named output ports from runtime inputs.
 *
 * Port names are declared in `config.ports`. At execution time each port is
 * populated from the matching runtime input key, falling back to `config.values[key]`.
 * This node has no input ports and is used as a multi-slot pipeline entry point.
 *
 * @extends AbstractNodeDefinition
 */
export class MultiInputNodeDefinition extends AbstractNodeDefinition<
  typeof MultiInputConfigSchema
> {
  public readonly nodeType = 'multi-input';
  public readonly displayName = 'Multi-Input';
  public readonly category = 'Core';
  public readonly inputs: IDagNodeDefinition['inputs'] = [];
  public readonly outputs: IDagNodeDefinition['outputs'] = [];
  public readonly configSchemaDefinition = MultiInputConfigSchema;

  public override async estimateCostWithConfig(
    _input: TPortPayload,
    _context: INodeExecutionContext,
    _config: z.output<typeof MultiInputConfigSchema>,
  ): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: 0 } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    _context: INodeExecutionContext,
    config: z.output<typeof MultiInputConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, 'multi-input');
    const keys =
      config.ports.length > 0 ? config.ports : Object.keys({ ...config.values, ...input });
    for (const key of keys) {
      if (key === '_agentSummary') continue;
      const val = typeof input[key] === 'string' ? input[key] : (config.values[key] ?? '');
      io.setOutput(key, val);
    }
    io.setOutput(
      '_agentSummary',
      `Multi-input: emitted ${keys.length} port(s): ${keys.join(', ')}.`,
    );
    return { ok: true, value: io.toOutput() };
  }
}
