import {
  createBashTool,
  createEditTool,
  createReadTool,
  createShellTool,
  createWriteTool,
  globTool,
  grepTool,
  webFetchTool,
  webSearchTool,
  type ISandboxToolOptions,
} from '@robota-sdk/agent-tools';
import { type ITool } from '@robota-sdk/agent-core';
import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';

/**
 * Structural tool contract these agent-tools builtins satisfy (`FunctionTool` is owned by
 * `@robota-sdk/agent-core`, DATA-005 SSOT). Typed by the `ITool` interface rather than the concrete
 * class so it unifies across agent-core's dual ESM/CJS `.d.ts` (the class's private `eventService`
 * would otherwise read as a distinct nominal type). Only `.execute()` is used here.
 */
type FunctionTool = ITool;
import {
  buildTaskExecutionError,
  buildValidationError,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type IPortDefinition,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import { z } from 'zod';

/**
 * A builtin factory receives sandbox/cwd options; pure builtins (glob/grep/web-*)
 * ignore them and return their shared singleton instance.
 */
type ToolFactory = (options: ISandboxToolOptions) => FunctionTool;

/** Static allowlist mapping `toolName` → the agent-tools builtin factory. */
const TOOL_FACTORIES: Readonly<Record<string, ToolFactory>> = {
  read: (o) => createReadTool(o),
  write: (o) => createWriteTool(o),
  edit: (o) => createEditTool(o),
  shell: (o) => createShellTool(o),
  bash: (o) => createBashTool(o),
  glob: () => globTool,
  grep: () => grepTool,
  'web-fetch': () => webFetchTool,
  'web-search': () => webSearchTool,
};

/** The builtin tool names this node can run in-process. */
export const TOOL_NODE_ALLOWED_TOOLS: readonly string[] = Object.freeze(
  Object.keys(TOOL_FACTORIES),
);

export const ToolNodeConfigSchema = z.object({
  /** Which in-process agent-tools builtin to run (see TOOL_NODE_ALLOWED_TOOLS). */
  toolName: z.string().min(1),
  /** Static tool arguments; the `params` input port is merged over these (input wins). */
  params: z.record(z.unknown()).default({}),
  /** Path restriction forwarded to file/shell builtins (ISandboxToolOptions.cwd). */
  cwd: z.string().optional(),
  /** Base credit cost per successful call (for cost estimation). */
  baseCredits: z.number().nonnegative().default(0),
});

export type TToolNodeConfig = z.infer<typeof ToolNodeConfigSchema>;

const TOOL_INPUTS: IPortDefinition[] = [
  {
    key: 'params',
    label: 'Tool Parameters (JSON string)',
    order: 0,
    type: 'string',
    required: false,
  },
];

const TOOL_OUTPUTS: IPortDefinition[] = [
  { key: 'output', label: 'Output', order: 0, type: 'string', required: true },
  { key: 'isError', label: 'Is Error', order: 1, type: 'boolean', required: true },
];

/**
 * Coerce a builtin's raw return value into `{ output, isError }`.
 *
 * Builtins return either plain text (success) or a JSON-encoded
 * `IToolInvocationResult` with `success: false` for soft, tool-reported
 * failures (e.g. a missing/binary file). Both shapes are normalised here.
 */
function coerceToolResult(data: unknown): { output: string; isError: boolean } {
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? '');
  try {
    const parsed = JSON.parse(text) as { success?: unknown; output?: unknown; error?: unknown };
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.success === 'boolean') {
      const value = parsed.success ? parsed.output : (parsed.error ?? parsed.output);
      return {
        output: typeof value === 'string' ? value : String(value ?? ''),
        isError: !parsed.success,
      };
    }
  } catch {
    // allow-fallback: non-JSON output is plain success text
  }
  return { output: text, isError: false };
}

function invalidParamsError(toolName: string, message: string, suggestion: string): IDagError {
  return buildValidationError(
    'DAG_VALIDATION_TOOL_INVALID_PARAMS',
    message,
    { toolName },
    { action: 'set_input', suggestion },
  );
}

/**
 * Resolve the optional `params` input port into a plain object, merged later
 * over `config.params`. A JSON string is parsed; a non-object decode is rejected.
 */
function resolveInputParams(
  rawParams: ReturnType<NodeIoAccessor['getInput']>,
  toolName: string,
): TResult<Record<string, unknown>, IDagError> {
  if (typeof rawParams === 'string' && rawParams.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawParams);
    } catch {
      return {
        ok: false,
        error: invalidParamsError(
          toolName,
          'The `params` input port must be a JSON object string.',
          'Provide a valid JSON object as the params input',
        ),
      };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        error: invalidParamsError(
          toolName,
          'The `params` input port must decode to a JSON object.',
          'Provide a JSON object (not an array or primitive)',
        ),
      };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  }
  if (rawParams !== null && typeof rawParams === 'object' && !Array.isArray(rawParams)) {
    return { ok: true, value: rawParams as Record<string, unknown> };
  }
  return { ok: true, value: {} };
}

/** Execute the selected builtin and map its result onto the node's output ports. */
async function runBuiltin(
  tool: FunctionTool,
  params: Record<string, unknown>,
  toolName: string,
  nodeId: string,
): Promise<TResult<TPortPayload, IDagError>> {
  try {
    const result = await tool.execute(params as unknown as Parameters<FunctionTool['execute']>[0]);
    const { output, isError } = coerceToolResult(result.data);

    const out = new NodeIoAccessor({}, nodeId);
    out.setOutput('output', output);
    out.setOutput('isError', isError);
    out.setOutput(
      '_agentSummary',
      `Tool "${toolName}" ran. ${isError ? 'Reported an error.' : `Output: ${output.length} chars.`}`,
    );
    return { ok: true, value: out.toOutput() };
  } catch (err) {
    // allow-fallback: a thrown ValidationError/ToolExecutionError is a hard node failure
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: buildTaskExecutionError(
        'DAG_TASK_EXECUTION_TOOL_CALL_FAILED',
        `Tool "${toolName}" failed: ${message}`,
        true,
        { toolName },
      ),
    };
  }
}

export class ToolNodeDefinition extends AbstractNodeDefinition<typeof ToolNodeConfigSchema> {
  public readonly nodeType = 'tool';
  public readonly displayName = 'Tool';
  public readonly category = 'Integration';
  public readonly inputs: IDagNodeDefinition['inputs'] = TOOL_INPUTS;
  public readonly outputs: IDagNodeDefinition['outputs'] = TOOL_OUTPUTS;
  public readonly configSchemaDefinition = ToolNodeConfigSchema;
  public override readonly defaultInputPort = 'params';
  public override readonly defaultOutputPort = 'output';

  public constructor() {
    super();
  }

  public async estimateCostWithConfig(
    _input: TPortPayload,
    _context: INodeExecutionContext,
    config: TToolNodeConfig,
  ): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: config.baseCredits } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: TToolNodeConfig,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const factory = TOOL_FACTORIES[config.toolName];
    if (!factory) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_TOOL_UNKNOWN_TOOL',
          `Unknown toolName "${config.toolName}". Choose one of the supported in-process builtins.`,
          { toolName: config.toolName },
          {
            action: 'set_config',
            suggestion: 'Set toolName to a supported builtin',
            options: [...TOOL_NODE_ALLOWED_TOOLS],
          },
        ),
      };
    }

    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const paramsResult = resolveInputParams(io.getInput('params'), config.toolName);
    if (!paramsResult.ok) return paramsResult;

    const merged = { ...config.params, ...paramsResult.value };
    const tool = factory(config.cwd !== undefined ? { cwd: config.cwd } : {});
    return runBuiltin(tool, merged, config.toolName, context.nodeDefinition.nodeId);
  }
}

export function createToolNodeDefinition(): ToolNodeDefinition {
  return new ToolNodeDefinition();
}
