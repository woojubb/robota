/**
 * Result returned by a CLI tool invocation
 */
export interface TToolResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}
