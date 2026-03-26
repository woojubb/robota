/**
 * Provider factory — creates AI provider instance from settings.
 *
 * CLI owns provider creation. Reads settings to determine which
 * provider package to use, creates the instance, passes to SDK.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

interface IProviderConfig {
  name: string;
  model: string;
  apiKey: string;
}

/** Read provider settings from the settings file chain. */
export function readProviderSettings(cwd: string): IProviderConfig {
  const paths = [
    join(cwd, '.robota', 'settings.local.json'),
    join(cwd, '.robota', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(homedir(), '.robota', 'settings.json'),
    join(homedir(), '.claude', 'settings.json'),
  ];

  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as {
        provider?: { name?: string; model?: string; apiKey?: string };
      };
      const provider = parsed.provider;
      if (provider?.apiKey && provider?.name) {
        return {
          name: provider.name,
          model: provider.model ?? 'claude-sonnet-4-6',
          apiKey: provider.apiKey,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error('No provider configuration found. Run `robota` to set up.');
}

/** Create a provider instance from settings. */
export function createProviderFromSettings(cwd: string, modelOverride?: string): IAIProvider {
  const settings = readProviderSettings(cwd);
  const model = modelOverride ?? settings.model;

  switch (settings.name) {
    case 'anthropic':
      return new AnthropicProvider({ apiKey: settings.apiKey, defaultModel: model });
    default:
      throw new Error(`Unknown provider: ${settings.name}. Currently supported: anthropic`);
  }
}
