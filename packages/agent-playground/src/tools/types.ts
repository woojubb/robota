/**
 * Tool catalog metadata for Playground UI (not a tool execution contract).
 */
export interface IPlaygroundToolMeta {
  id: string;
  name: string;
  type?: 'builtin' | 'mcp' | 'openapi' | 'zod';
  description?: string;
  category?: string;
  tags?: string[];
  parametersSummary?: Array<{
    name: string;
    type: string;
    required?: boolean;
    description?: string;
  }>;
}
