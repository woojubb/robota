import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
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

/** Allowed stdio executable names — defense-in-depth; the authoritative whitelist lives in the runtime server. */
const STDIO_ALLOWED_EXECUTABLES = new Set(['npx', 'node', 'python', 'python3', 'uvx', 'deno']);

function isAllowedStdioExecutable(command: string): boolean {
  const executable = command.trim().split(/\s+/)[0] ?? '';
  return STDIO_ALLOWED_EXECUTABLES.has(executable);
}

/** Block internal/private IP ranges to prevent SSRF. Returns error or undefined. */
function validateHttpUrl(rawUrl: string): IDagError | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // allow-fallback: invalid URL caught here
    return buildValidationError(
      'DAG_VALIDATION_MCP_TOOL_INVALID_URL',
      `serverUrl is not a valid URL: "${rawUrl}"`,
      { serverUrl: rawUrl },
      { action: 'set_config', suggestion: 'Provide a valid http:// or https:// URL' },
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return buildValidationError(
      'DAG_VALIDATION_MCP_TOOL_INVALID_URL',
      `serverUrl must use http or https, got: "${parsed.protocol}"`,
      { serverUrl: rawUrl, protocol: parsed.protocol },
      { action: 'set_config', suggestion: 'Use an http:// or https:// URL' },
    );
  }

  const h = parsed.hostname;
  const isPrivate =
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^fd[0-9a-f]{2}:/i.test(h);

  if (isPrivate) {
    return buildValidationError(
      'DAG_VALIDATION_MCP_TOOL_SSRF_BLOCKED',
      `serverUrl targets a private/internal address which is not allowed: "${h}"`,
      { serverUrl: rawUrl, hostname: h },
      { action: 'set_config', suggestion: 'Use a publicly reachable MCP server URL' },
    );
  }

  return undefined;
}

export const McpToolNodeConfigSchema = z.object({
  /** Transport type. HTTP is recommended for production; stdio requires pre-registration. */
  serverType: z.enum(['http', 'stdio']).default('http'),
  /** HTTP/HTTPS URL of the MCP server (required when serverType='http'). */
  serverUrl: z.string().optional(),
  /** Executable for stdio transport (required when serverType='stdio'). */
  serverCommand: z.string().optional(),
  /** Extra arguments appended to the stdio command. */
  serverArgs: z.array(z.string()).default([]),
  /**
   * Environment variable *names* to forward to the stdio child process.
   * Values are resolved from process.env at runtime — never stored in config.
   */
  serverEnvRefs: z.array(z.string()).default([]),
  /** Name of the MCP tool to call on the server. */
  toolName: z.string().min(1),
  /** Per-call timeout in milliseconds. */
  timeoutMs: z.number().int().positive().default(30000),
  /** Base credit cost per successful tool call (for cost estimation). */
  baseCredits: z.number().nonnegative().default(0),
});

export type TMcpToolNodeConfig = z.infer<typeof McpToolNodeConfigSchema>;

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => (b as TextContent).text)
    .join('\n');
}

const MCP_TOOL_INPUTS: IPortDefinition[] = [
  {
    key: 'args',
    label: 'Tool Arguments (JSON string)',
    order: 0,
    type: 'string',
    required: false,
  },
];

const MCP_TOOL_OUTPUTS: IPortDefinition[] = [
  { key: 'text', label: 'Result Text', order: 0, type: 'string', required: true },
  { key: 'isError', label: 'Is Error', order: 1, type: 'boolean', required: true },
];

export class McpToolNodeDefinition extends AbstractNodeDefinition<typeof McpToolNodeConfigSchema> {
  public readonly nodeType = 'mcp-tool';
  public readonly displayName = 'MCP Tool';
  public readonly category = 'Integration';
  public readonly inputs: IDagNodeDefinition['inputs'] = MCP_TOOL_INPUTS;
  public readonly outputs: IDagNodeDefinition['outputs'] = MCP_TOOL_OUTPUTS;
  public readonly configSchemaDefinition = McpToolNodeConfigSchema;
  public override readonly defaultInputPort = 'args';
  public override readonly defaultOutputPort = 'text';

  public constructor() {
    super();
  }

  public async estimateCostWithConfig(
    _input: TPortPayload,
    _context: INodeExecutionContext,
    config: TMcpToolNodeConfig,
  ): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: config.baseCredits } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: TMcpToolNodeConfig,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);

    // Args input is optional; default to empty object
    const argsInput = io.getInput('args');
    const argsRaw = typeof argsInput === 'string' ? argsInput : '{}';
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsRaw) as Record<string, unknown>;
    } catch {
      // allow-fallback: invalid JSON treated as empty args
      args = {};
    }

    // Build transport
    let transport: StdioClientTransport | StreamableHTTPClientTransport;
    if (config.serverType === 'http') {
      if (!config.serverUrl) {
        return {
          ok: false,
          error: buildValidationError(
            'DAG_VALIDATION_MCP_TOOL_MISSING_URL',
            'serverUrl is required when serverType is "http"',
            { toolName: config.toolName },
            { action: 'set_config', suggestion: 'Set serverUrl to the MCP server HTTP endpoint' },
          ),
        };
      }
      const urlError = validateHttpUrl(config.serverUrl);
      if (urlError) return { ok: false, error: urlError };
      transport = new StreamableHTTPClientTransport(new URL(config.serverUrl));
    } else {
      if (!config.serverCommand) {
        return {
          ok: false,
          error: buildValidationError(
            'DAG_VALIDATION_MCP_TOOL_MISSING_COMMAND',
            'serverCommand is required when serverType is "stdio"',
            { toolName: config.toolName },
            { action: 'set_config', suggestion: 'Set serverCommand to the MCP server executable' },
          ),
        };
      }
      if (!isAllowedStdioExecutable(config.serverCommand)) {
        return {
          ok: false,
          error: buildValidationError(
            'DAG_VALIDATION_MCP_TOOL_STDIO_NOT_ALLOWED',
            `stdio command "${config.serverCommand}" uses a disallowed executable. Use a pre-registered server.`,
            { serverCommand: config.serverCommand },
            {
              action: 'set_config',
              suggestion:
                'Use serverType="http" or register the stdio server at runtime-server startup',
              options: Array.from(STDIO_ALLOWED_EXECUTABLES),
            },
          ),
        };
      }

      // Resolve env vars from names only — never serialize secret values into config
      const resolvedEnv: Record<string, string> = {};
      for (const envRef of config.serverEnvRefs) {
        const val = process.env[envRef];
        if (typeof val === 'string') {
          resolvedEnv[envRef] = val;
        }
      }

      const tokens = config.serverCommand.trim().split(/\s+/);
      const cmd = tokens[0] ?? config.serverCommand;
      const cmdArgs = tokens.slice(1);
      transport = new StdioClientTransport({
        command: cmd,
        args: [...cmdArgs, ...config.serverArgs],
        env: resolvedEnv,
      });
    }

    const client = new Client(
      { name: 'dag-mcp-tool-node', version: '1.0.0' },
      { capabilities: {} },
    );

    const timeoutHandle = setTimeout(() => {
      void client.close();
    }, config.timeoutMs);

    try {
      await client.connect(transport);
      const result = await client.callTool({ name: config.toolName, arguments: args });
      clearTimeout(timeoutHandle);

      const isError = result.isError === true;
      const text = extractText((result.content as Array<{ type: string; text?: string }>) ?? []);

      const out = new NodeIoAccessor({}, context.nodeDefinition.nodeId);
      out.setOutput('text', text);
      out.setOutput('isError', isError);
      out.setOutput(
        '_agentSummary',
        `Tool "${config.toolName}" called. ${isError ? 'Returned error.' : `Output: ${text.length} chars.`}`,
      );
      return { ok: true, value: out.toOutput() };
    } catch (err) {
      // allow-fallback: MCP call failures wrapped as task execution errors
      clearTimeout(timeoutHandle);
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_MCP_TOOL_CALL_FAILED',
          `MCP tool call failed for "${config.toolName}": ${message}`,
          true,
          { toolName: config.toolName, serverType: config.serverType },
        ),
      };
    } finally {
      try {
        await client.close();
      } catch {
        // allow-fallback: best-effort close, non-fatal
        // intentionally empty
      }
    }
  }
}

export function createMcpToolNodeDefinition(): McpToolNodeDefinition {
  return new McpToolNodeDefinition();
}
