import { existsSync, readFileSync } from 'node:fs';
import { checkSettingsDocument } from '@robota-sdk/agent-sdk';
import type { TProviderSettingsDocument, TSettingsCheck } from '@robota-sdk/agent-sdk';
import type { IProviderDefinition } from './provider-definition.js';

export { checkSettingsDocument };
export type { TSettingsCheck };

/** Check a settings file's state for first-run setup. */
export function checkSettingsFile(
  filePath: string,
  providerDefinitions: readonly IProviderDefinition[] = [],
): TSettingsCheck {
  if (!existsSync(filePath)) return 'missing';
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (raw.length === 0) return 'incomplete';
    const parsed = JSON.parse(raw) as TProviderSettingsDocument;
    return checkSettingsDocument(parsed, providerDefinitions);
  } catch {
    // allow-fallback: corrupt file is a valid terminal state, not a silent recovery
    return 'corrupt';
  }
}
