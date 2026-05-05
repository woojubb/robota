import type {
  IDagOrchestrationHttpClient,
  IDagOrchestrationHttpPayload,
} from '@robota-sdk/dag-api';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export const DEFAULT_DAG_SERVER_URL = 'http://localhost:3012';

export interface IDagMcpEnvironment {
  readonly ROBOTA_DAG_SERVER_URL?: string;
}

export interface IDagMcpServerOptions {
  readonly name?: string;
  readonly version?: string;
  readonly client: IDagOrchestrationHttpClient;
}

export interface IDagMcpRunOptions {
  readonly env?: IDagMcpEnvironment;
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export type IDagMcpToolDefinition = Tool;

export interface IDagMcpTextContent {
  readonly type: 'text';
  readonly text: string;
}

export interface IDagMcpToolCallResult extends CallToolResult {
  readonly content: IDagMcpTextContent[];
  readonly isError: boolean;
}

export type IDagMcpUsageErrorPayload = IDagOrchestrationHttpPayload & {
  readonly ok: false;
  readonly status: 2;
  readonly errors: readonly [
    {
      readonly type: string;
      readonly title: string;
      readonly status: 2;
      readonly detail: string;
      readonly instance: string;
      readonly code: 'DAG_MCP_USAGE_ERROR';
      readonly retryable: false;
    },
  ];
};
