import type {
  IDagOrchestrationPort,
  IDagOrchestrationHttpPayload,
} from '@robota-sdk/dag-orchestration-client';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

// Native DAG runtime server default (apps/dag-runtime-server binds 3939 by default).
export const DEFAULT_DAG_SERVER_URL = 'http://localhost:3939';

export interface IDagMcpEnvironment {
  /** Native DAG runtime-server base URL (WORKFLOW-002). Overridden by the `--server-url` flag. */
  readonly DAG_RUNTIME_SERVER_URL?: string;
  readonly ROBOTA_DAG_EMBEDDED?: string;
}

export interface IDagMcpServerOptions {
  readonly name?: string;
  readonly version?: string;
  readonly client: IDagOrchestrationPort;
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
