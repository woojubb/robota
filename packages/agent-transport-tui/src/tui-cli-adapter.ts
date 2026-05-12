import type {
  TStatusLineCommandSettingsPatch,
  IStatusLineCommandSettings,
  CommandRegistry,
} from '@robota-sdk/agent-sdk';
import type { TUniversalValue } from '@robota-sdk/agent-core';

export interface ITuiCliAdapter {
  getUserSettingsPath(): string;
  readSettings(path: string): Record<string, TUniversalValue>;
  writeSettings(path: string, settings: Record<string, TUniversalValue>): void;
  deleteSettings(path: string): boolean;
  applyStatusLineSettings(
    path: string,
    patch: TStatusLineCommandSettingsPatch,
  ): IStatusLineCommandSettings;
  reloadPluginCommandSource(registry: CommandRegistry): void;
  applyActiveModelChange(
    cwd: string,
    modelId: string,
    options?: { providerOverride?: string },
  ): { applied: boolean };
  getGitBranch(cwd: string): string | undefined;
  getProviderDisplayName(type: string): string;
}
