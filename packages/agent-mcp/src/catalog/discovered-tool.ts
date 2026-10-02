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
import { additionalObservation } from './content-observations.js';

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
  IToolProvenance,
  IToolSchema,
  IToolWithEventService,
  IUniversalObjectValue,
  IToolResultAdmissionOptions,
  TToolParameters,
  TUniversalMessagePart,
} from '@robota-sdk/agent-core';

function imageDiagnostic(mimeType: unknown, data: unknown): string | undefined {
  if (
    typeof mimeType !== 'string' ||
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)
  )
    return 'MCP image omitted: unsupported MIME type';
  if (
    typeof data !== 'string' ||
    !data.length ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)
  )
    return 'MCP image omitted: invalid base64 data';
  // Check the declared format against its binary signature without decoding an unbounded body.
  const header = atob(data.slice(0, 48));
  const tail = atob(data.slice(-48));
  const decodedBytes =
    (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  const matches =
    mimeType === 'image/png'
      ? header.startsWith('\x89PNG\r\n\x1a\n') &&
        header.slice(12, 16) === 'IHDR' &&
        decodedBytes >= 45 &&
        tail.endsWith('\x00\x00\x00\x00IEND\xaeB\x60\x82')
      : mimeType === 'image/jpeg'
        ? header.startsWith('\xff\xd8\xff') && decodedBytes >= 20 && tail.endsWith('\xff\xd9')
        : mimeType === 'image/gif'
          ? (header.startsWith('GIF87a') || header.startsWith('GIF89a')) &&
            decodedBytes >= 14 &&
            tail.endsWith(';')
          : header.startsWith('RIFF') &&
            header.slice(8, 12) === 'WEBP' &&
            decodedBytes >= 20 &&
            header.charCodeAt(4) +
              header.charCodeAt(5) * 256 +
              header.charCodeAt(6) * 65536 +
              header.charCodeAt(7) * 16777216 ===
              decodedBytes - 8;
  return matches ? undefined : 'MCP image omitted: invalid image data';
}

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
  /** Host revalidation immediately before transport dispatch; this never grants authority. */
  readonly isDispatchAdmitted?: () => boolean | Promise<boolean>;
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
  readonly provenance: IToolProvenance;

  /** Held for the runtime's benefit; see `setEventService`. This tool emits nothing of its own. */
  private eventService: IEventService | undefined;

  /** CORE-040: built once and cached — narrowing is a property of the schema, not of a call. */
  private readonly validator: ThirdPartySchemaValidator;

  constructor(
    private readonly entry: IMCPCatalogToolEntry,
    private readonly invoker: IMCPToolInvoker,
    private readonly options?: ICreateDiscoveredToolOptions,
  ) {
    this.provenance = Object.freeze({
      sourceId: entry.provenance.serverId,
      component: entry.sourceName,
      origin: entry.provenance.origin,
      ...(entry.provenance.serverVersion ? { version: entry.provenance.serverVersion } : {}),
      protocolVersion: entry.provenance.protocolVersion,
    });
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
      if (this.options?.isDispatchAdmitted && !(await this.options.isDispatchAdmitted())) {
        return {
          success: false,
          error:
            'MCP call refused: admission or installed source changed. Review /mcp status and restart after approving the current source.',
        };
      }
      if (context?.signal?.aborted)
        throw new DOMException('Execution interrupted by user', 'AbortError');
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

    const parts: TUniversalMessagePart[] = [];
    let invalidObservation: string | undefined;
    for (const content of result.content) {
      if (content['type'] === 'text' && typeof content['text'] === 'string')
        parts.push({ type: 'text', text: content['text'] });
      else if (content['type'] === 'image') {
        const diagnostic = imageDiagnostic(content['mimeType'], content['data']);
        if (diagnostic) {
          invalidObservation ??= diagnostic;
          parts.push({ type: 'text', text: diagnostic });
        } else if (typeof content['mimeType'] === 'string' && typeof content['data'] === 'string') {
          parts.push({
            type: 'image_inline',
            mimeType: content['mimeType'],
            data: content['data'],
          });
        }
      } else {
        const observation = additionalObservation(content);
        if (observation && 'part' in observation) parts.push(observation.part);
        else if (observation) {
          invalidObservation ??= observation.diagnostic;
          parts.push({ type: 'text', text: observation.diagnostic });
        }
      }
    }

    if (result.isError || invalidObservation) {
      const message = joinTextContent(result.content);
      return admitToolResult(
        this.schema.name,
        {
          success: false,
          ...(result.structuredContent !== undefined
            ? { data: toUniversalValue(result.structuredContent) }
            : {}),
          ...(parts.length ? { parts } : {}),
          error:
            [message, invalidObservation].filter(Boolean).join('\n') ||
            `${this.schema.name} reported an error`,
        },
        this.options?.admission,
        this.entry.maxResultChars,
      );
    }

    const data =
      result.structuredContent !== undefined
        ? toUniversalValue(result.structuredContent)
        : joinTextContent(result.content);

    return admitToolResult(
      this.schema.name,
      { success: true, data, ...(parts.length ? { parts } : {}) },
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
