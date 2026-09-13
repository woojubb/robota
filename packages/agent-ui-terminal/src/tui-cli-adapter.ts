import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { CommandRegistry } from '@robota-sdk/agent-framework';

/**
 * CLI seam injected into the renderer.
 *
 * CMD-004 Phase 2 Stage C: READ-ONLY toward settings — the renderer re-reads the persisted
 * settings document for display (statusline refresh-on-result) but never writes it. All settings
 * mutations are host actions executed by the session layer via `ICommandHostAdapters`.
 */
export interface ITuiCliAdapter {
  getUserSettingsPath(): string;
  readSettings(path: string): Record<string, TUniversalValue>;
  reloadPluginCommandSource(registry: CommandRegistry): void;
  applyActiveModelChange(
    cwd: string,
    modelId: string,
    options?: { providerOverride?: string },
  ): { applied: boolean };
  getGitBranch(cwd: string): string | undefined;
  getProviderDisplayName(type: string): string;
}
