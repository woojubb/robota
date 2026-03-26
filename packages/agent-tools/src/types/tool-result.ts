/**
 * Result returned by a CLI tool invocation
 */
export interface TToolResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
  /** Start line number of the edit in the original file (Edit tool only) */
  startLine?: number;
}
