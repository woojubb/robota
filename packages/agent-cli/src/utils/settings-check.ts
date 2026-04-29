import { existsSync, readFileSync } from 'node:fs';

/** Result of checking a settings file. */
export type TSettingsCheck = 'missing' | 'valid' | 'corrupt' | 'incomplete';

interface IProviderSettingsShape {
  provider?: { apiKey?: string };
  currentProvider?: string;
  providers?: Record<string, { type?: string; apiKey?: string }>;
}

/** Check a settings file's state for first-run setup. */
export function checkSettingsFile(filePath: string): TSettingsCheck {
  if (!existsSync(filePath)) return 'missing';
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (raw.length === 0) return 'incomplete';
    const parsed = JSON.parse(raw) as IProviderSettingsShape;
    if (!hasUsableProviderConfig(parsed)) return 'incomplete';
    return 'valid';
  } catch {
    return 'corrupt';
  }
}

function hasUsableProviderConfig(settings: IProviderSettingsShape): boolean {
  if (settings.provider?.apiKey) {
    return true;
  }
  if (typeof settings.currentProvider !== 'string') {
    return false;
  }
  const profile = settings.providers?.[settings.currentProvider];
  return !!profile?.apiKey || profile?.type === 'openai';
}
