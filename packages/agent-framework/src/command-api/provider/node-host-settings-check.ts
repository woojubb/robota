import { existsSync, readFileSync } from 'node:fs';

import { processEnvResolver } from '@robota-sdk/agent-core/node';

import { checkSettingsDocument } from './settings-check.js';

import type { TProviderSettingsDocument } from './provider-settings.js';
import type { TSettingsCheck } from './settings-check.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

/**
 * Explicit host-filesystem settings probe: reads the file and resolves `$ENV:` references against
 * the live process environment. This does not establish project trust.
 */
export function checkNodeHostSettingsFile(
  filePath: string,
  providerDefinitions: readonly IProviderDefinition[] = [],
): TSettingsCheck {
  if (!existsSync(filePath)) return 'missing';
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (raw.length === 0) return 'incomplete';
    const parsed = JSON.parse(raw) as TProviderSettingsDocument;
    return checkSettingsDocument(parsed, providerDefinitions, processEnvResolver);
  } catch {
    // allow-fallback: corrupt settings file is a valid terminal state ('corrupt')
    return 'corrupt';
  }
}
