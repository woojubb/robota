import type { TToolParameters } from '@robota-sdk/agent-core';
import type { IUniversalObjectValue } from '@robota-sdk/agent-core';

const ID_RADIX = 36;
const ID_SUBSTR_END = 11;

/**
 * MCP (Model Context Protocol) tool configuration
 */
export interface IMCPConfig {
  endpoint: string;
  apiKey?: string;
  timeout?: number;
  retries?: number;
  headers?: Record<string, string>;
}

/**
 * MCP protocol message types
 */
export interface IMCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: IMCPRequestParams;
}

export interface IMCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: IMCPResultData;
  error?: IMCPError;
}

export interface IMCPRequestParams {
  tool: string;
  arguments: TToolParameters;
  metadata?: Record<string, string | number | boolean>;
}

export interface IMCPResultData {
  content: string | Record<string, string | number | boolean | null>;
  metadata?: Record<string, string | number | boolean>;
  isError?: boolean;
}

export interface IMCPError {
  code: number;
  message: string;
  data?: Record<string, string | number | boolean>;
}

/**
 * MCP connection status
 */
export type TMCPConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'disconnecting'
  | 'error';

/**
 * Build a JSON-RPC 2.0 MCP request from tool name and parameters.
 */
export function buildMCPRequest(
  toolName: string,
  parameters: TToolParameters,
  headers?: Record<string, string>,
): IMCPRequest {
  const requestId = `${toolName}-${Date.now()}-${Math.random().toString(ID_RADIX).substring(2, ID_SUBSTR_END)}`;

  const mcpParams: IMCPRequestParams = {
    tool: toolName,
    arguments: parameters,
  };

  // Add metadata if configured
  if (headers) {
    mcpParams.metadata = headers as Record<string, string | number | boolean>;
  }

  return {
    jsonrpc: '2.0',
    id: requestId,
    method: 'tools/call',
    params: mcpParams,
  } satisfies IMCPRequest;
}

/**
 * Execute an MCP request (protocol stub — not yet implemented).
 * Returns a formatted error response when execution is unavailable.
 */
export async function executeMCPRequest(
  request: IMCPRequest,
  endpoint: string,
): Promise<IMCPResponse> {
  try {
    // TODO: Implement actual MCP protocol communication
    // This would typically use WebSocket or HTTP POST to the MCP server
    throw new Error('Not implemented: actual MCP execution is not yet available');
  } catch (error) {
    // Return error response in MCP format
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603, // Internal error
        message: error instanceof Error ? error.message : String(error),
        data: { endpoint },
      },
    } satisfies IMCPResponse;
  }
}

/**
 * Process an MCP response and extract a typed execution result.
 */
export function processMCPResponse(response: IMCPResponse): IUniversalObjectValue {
  if (response.error) {
    const errorData: IUniversalObjectValue = {
      success: false,
      content: response.error.message,
      metadata: response.error.data ?? undefined,
    };
    return errorData;
  }

  if (response.result) {
    const okData: IUniversalObjectValue = {
      success: true,
      content: response.result.content,
      metadata: response.result.metadata ?? undefined,
    };
    return okData;
  }

  // Unexpected response format
  const unexpected: IUniversalObjectValue = {
    success: false,
    content: 'Unexpected MCP response format',
    metadata: { responseId: String(response.id) },
  };
  return unexpected;
}
