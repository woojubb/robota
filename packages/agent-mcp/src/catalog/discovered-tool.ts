/**
 * Wraps a catalog tool entry as a runtime tool (MCP-002 / TOOL-006).
 *
 * `IMCPCatalogToolEntry` is data — a name, a narrowed schema, a source name. This turns it into
 * something the runtime can actually call: an {@link IToolWithEventService}, the SAME generic
 * dynamic-tool contract every other tool in this repo satisfies. Nothing MCP-specific is added to
 * that contract — `agent-framework` is untouched by this unit (TC-08).
 *
 * Deliberately does NOT extend `AbstractTool`: `agent-mcp` sits below `agent-framework` in the
 * dependency graph, and `AbstractTool` lives in `agent-core` alongside types that pull the
 * framework back in, which is the circular-dependency rule `mcp-tool.ts` and `relay-mcp-tool.ts`
 * already avoid the same way.
 */

import { admitToolResult } from '@robota-sdk/agent-core';

import { classifyMcpFailure } from '../supervisor/connection.js';
import { ThirdPartySchemaValidator } from '../third-party-schema.js';
import { toUniversalValue } from './universal-value.js';

import type { IMCPToolCallResult } from '../client/session.js';
import type { TUnenforceableSchemaReporter } from '../third-party-schema.js';
import type { IMCPCatalogToolEntry } from './types.js';
import type {
  IEventService,
  IObjectParameterSchema,
  IOutboundTraceContext,
  IParameterSchema,
  IParameterValidationResult,
  IToolExecutionContext,
  IToolResult,
  IToolSchema,
  IToolWithEventService,
  IUniversalObjectValue,
  IToolResultAdmissionOptions,
  TToolParameters,
} from '@robota-sdk/agent-core';

/** The narrow shape `createDiscoveredTool` needs from a connection supervisor. */
export interface IMCPToolInvoker {
  callTool(
    name: string,
    args: TToolParameters,
    options?: {
      readonly signal?: AbortSignal;
      readonly outboundTraceContext?: IOutboundTraceContext;
    },
  ): Promise<IMCPToolCallResult>;
}

export interface ICreateDiscoveredToolOptions {
  /** Host-owned generic admission policy and spill storage; MCP only supplies validated metadata. */
  readonly admission?: IToolResultAdmissionOptions;
  /**
   * CORE-040 hook, forwarded to the validator for defensive symmetry with `MCPTool`/
   * `RelayMcpTool`. In practice it is never invoked here: `entry.schema` was already narrowed once
   * at catalog build time (`./build.ts`), and re-narrowing an already-narrowed schema is a no-op
   * (every remaining node is, by construction, expressible) — so this option exists to keep the
   * shape consistent with the sibling tool classes, not because a second report is expected.
   */
  readonly report?: TUnenforceableSchemaReporter;
  /**
   * The host's fixed, content-free words for a call that failed because the server wants the user
   * to authenticate — naming what the user must run. Absent, such a failure reads like any other.
   * The server's own error text never replaces it.
   */
  readonly authFailureNotice?: string;
}

/**
 * `entry.schema` (`IParameterSchema`) is the enforceable copy of a THIRD-PARTY `inputSchema`. MCP
 * tool inputs are always JSON-Schema object roots, so the ordinary case is a same-shape copy with
 * `properties` guaranteed present; the fallback exists only so a root this repo's universal subset
 * could not express at all (`narrowToUniversalSubset`'s own empty-object case) still produces a
 * valid {@link IObjectParameterSchema} rather than a value the tool schema contract rejects.
 */
function toObjectParameterSchema(schema: IParameterSchema): IObjectParameterSchema {
  if (schema.type === 'object') {
    return { ...schema, type: 'object', properties: schema.properties ?? {} };
  }
  return { type: 'object', properties: {} };
}

/** Joins every text content block, in order — the same convention `processMCPResponse` uses. */
function joinTextContent(content: readonly IUniversalObjectValue[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

/**
 * The runtime tool for one catalog entry.
 *
 * A class, not a closure-backed object literal: `tool-006-registrable.test.ts` (and this unit's
 * mirror of it, `dynamic-tool-registration.test.ts`) assert retention by reading the `eventService`
 * field back off the instance, the same way `MCPTool` and `RelayMcpTool` expose theirs.
 */
class DiscoveredMCPTool implements IToolWithEventService {
  readonly schema: IToolSchema;

  /** Held for the runtime's benefit; see `setEventService`. This tool emits nothing of its own. */
  private eventService: IEventService | undefined;

  /** CORE-040: built once and cached — narrowing is a property of the schema, not of a call. */
  private readonly validator: ThirdPartySchemaValidator;

  constructor(
    private readonly entry: IMCPCatalogToolEntry,
    private readonly invoker: IMCPToolInvoker,
    private readonly options?: ICreateDiscoveredToolOptions,
  ) {
    this.schema = {
      name: entry.canonicalName,
      description: entry.description ?? '',
      parameters: toObjectParameterSchema(entry.schema),
    };
    // Reuses `this.schema.parameters`, which IS `entry.schema` (already narrowed once at catalog
    // registration) — never the server's raw `inputSchema`.
    this.validator = new ThirdPartySchemaValidator(
      this.schema.name,
      this.schema.parameters,
      options?.report,
    );
  }

  getName(): string {
    return this.schema.name;
  }

  getDescription(): string {
    return this.schema.description;
  }

  validate(parameters: TToolParameters): boolean {
    return this.validateParameters(parameters).isValid;
  }

  validateParameters(parameters: TToolParameters): IParameterValidationResult {
    return this.validator.validate(parameters);
  }

  async execute(
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<IToolResult> {
    let result: IMCPToolCallResult;
    try {
      result = await this.invoker.callTool(this.entry.sourceName, parameters, {
        signal: context?.signal,
        ...(context?.outboundTraceContext
          ? { outboundTraceContext: context.outboundTraceContext }
          : {}),
      });
    } catch (error) {
      // SDK and remote errors can contain response bodies or request metadata. Neither is safe to
      // pass through ToolManager's error events or the session logger.
      if (context?.signal?.aborted)
        throw new DOMException('Execution interrupted by user', 'AbortError');
      // Only the classification is read — a fixed word — so the model learns that the user must
      // act and which command to suggest, and nothing the server sent.
      const notice = this.options?.authFailureNotice;
      if (notice !== undefined && classifyMcpFailure(error) === 'auth') {
        return { success: false, error: notice };
      }
      throw new Error('MCP tool call failed');
    }

    if (result.isError) {
      const message = joinTextContent(result.content);
      return admitToolResult(
        this.schema.name,
        {
          success: false,
          error: message.length > 0 ? message : `${this.schema.name} reported an error`,
        },
        this.options?.admission,
        this.entry.maxResultChars,
      );
    }

    const data = result.structuredContent
      ? toUniversalValue(result.structuredContent)
      : joinTextContent(result.content);

    return admitToolResult(
      this.schema.name,
      { success: true, data },
      this.options?.admission,
      this.entry.maxResultChars,
    );
  }

  /**
   * TOOL-006: retains the reference rather than discarding it. The runtime injects this so tool
   * lifecycle events are emitted; a no-op setter would satisfy the type and defeat the contract.
   */
  setEventService(eventService: IEventService | undefined): void {
    this.eventService = eventService;
  }
}

/**
 * Builds the runtime tool for one catalog entry.
 *
 * @param entry - the catalog's decision for this tool: its canonical name and its ONE narrowed schema
 * @param invoker - routes the call back to the server (`MCPConnectionSupervisor#callTool` in production)
 */
export function createDiscoveredTool(
  entry: IMCPCatalogToolEntry,
  invoker: IMCPToolInvoker,
  options?: ICreateDiscoveredToolOptions,
): IToolWithEventService {
  return new DiscoveredMCPTool(entry, invoker, options);
}
