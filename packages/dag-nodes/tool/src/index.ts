import {
  createBashTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createShellTool,
  createWriteTool,
  webFetchTool,
  webSearchTool,
} from '@robota-sdk/agent-tools';
import { isPathInside, type ITool } from '@robota-sdk/agent-core';
import { resolve } from 'node:path';
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
 * A builtin factory, always given a containment root (SEC-007).
 *
 * `cwd` is REQUIRED here rather than optional, for the reason `pack-coding`'s `ICodingPackOptions`
 * makes it required: `checkPathWithinCwd` is a NO-OP when `cwd` is `undefined`, so an optional root is
 * a guard that disarms itself by omission. The two builtins that reach the network (`web-fetch`,
 * `web-search`) have no filesystem path to contain and ignore it.
 */
type ToolFactory = (options: { cwd: string }) => FunctionTool;

/** Static allowlist mapping `toolName` → the agent-tools builtin factory. */
const TOOL_FACTORIES: Readonly<Record<string, ToolFactory>> = {
  read: (o) => createReadTool(o),
  write: (o) => createWriteTool(o),
  edit: (o) => createEditTool(o),
  // SEC-007: for these two the root is the DEFAULT WORKING DIRECTORY, not a boundary — deliberately,
  // and not to be "fixed" by reflex. A cwd guard on arbitrary command execution is undone by the
  // first `cd ..`, so it would constrain nothing while READING as a boundary in review. The real
  // boundary for command execution is the permission layer and the sandbox seam.
  shell: (o) => createShellTool(o),
  bash: (o) => createBashTool(o),
  // SEC-007: built per invocation and bound to the root, not the module-level `globTool`/`grepTool`
  // singletons this node used to hand back. Those are documented as UNCONTAINED precisely because a
  // singleton is context-free by construction — there is nothing for a containment root to bind to.
  glob: (o) => createGlobTool(o),
  grep: (o) => createGrepTool(o),
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
  /**
   * NARROWS the containment root. Omitted, the root is the directory the run was invoked from; set,
   * it must resolve INSIDE that directory or the node refuses to run (SEC-007). It cannot widen the
   * root, because it arrives in the same `.dag.json` as the path it would be containing.
   */
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

/**
 * SEC-007 — resolve the containment root every builtin this node runs is bound to.
 *
 * The boundary is the directory the run was invoked from. That is the same anchor the `file-read` and
 * `file-write` nodes use, and for the same stated reason: `INodeExecutionContext` carries no workspace
 * root, so this makes explicit the boundary the node was already implicitly claiming rather than
 * inventing a new concept. Without it this node was the way AROUND those two — `toolName: "read"`
 * with an absolute path did what `file-read` refuses.
 *
 * `config.cwd` may only NARROW that root. It comes out of the same LLM-authorable `.dag.json` as the
 * paths it is nominally containing, so honouring it as the boundary would let `{"cwd":"/"}` disarm
 * the guard by writing one line — a root the attacker supplies is not a root.
 *
 * Decided canonically through agent-core's shared `isPathInside` SSOT, so a `cwd` reached through a
 * symlink that escapes is refused too. A lexical check passes `escape/…` when `escape -> /`, because
 * `resolve()` never consults the filesystem; segment validation would not catch it either, since
 * `escape` is a perfectly plain segment.
 */
function resolveContainmentRoot(
  configCwd: string | undefined,
  nodeId: string,
): TResult<string, IDagError> {
  const invocationRoot = process.cwd();
  if (configCwd === undefined) return { ok: true, value: invocationRoot };

  const requested = resolve(invocationRoot, configCwd);
  if (!isPathInside(invocationRoot, requested)) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_TOOL_CWD_OUTSIDE_ROOT',
        `cwd "${configCwd}" resolves outside the working directory`,
        { nodeId },
        {
          action: 'set_config',
          suggestion: 'Set cwd to a directory inside the directory the run was invoked from',
        },
      ),
    };
  }
  return { ok: true, value: requested };
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

    const rootResult = resolveContainmentRoot(config.cwd, context.nodeDefinition.nodeId);
    if (!rootResult.ok) return rootResult;

    const merged = { ...config.params, ...paramsResult.value };
    const tool = factory({ cwd: rootResult.value });
    return runBuiltin(tool, merged, config.toolName, context.nodeDefinition.nodeId);
  }
}

export function createToolNodeDefinition(): ToolNodeDefinition {
  return new ToolNodeDefinition();
}
