'use client';

import { useState } from 'react';

export type TProviderName = 'anthropic' | 'openai' | 'gemini' | 'deepseek';

export interface IProviderConfig {
  provider: TProviderName;
  apiKey: string;
}

const STORAGE_KEY = 'robota-playground-provider';

function readStoredConfig(): IProviderConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    // allow-fallback: localStorage throws SecurityError in private browser mode
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'provider' in parsed &&
      'apiKey' in parsed &&
      typeof (parsed as Record<string, unknown>).provider === 'string' &&
      typeof (parsed as Record<string, unknown>).apiKey === 'string'
    ) {
      return parsed as IProviderConfig;
    }
    return null;
  } catch {
    // allow-fallback: localStorage throws SecurityError in private browser mode
    return null;
  }
}

export function useProviderConfig() {
  const [config, setConfigState] = useState<IProviderConfig | null>(() => readStoredConfig());

  const setConfig = (newConfig: IProviderConfig) => {
    try {
      // allow-fallback: localStorage unavailable in restricted environments
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
    } catch {
      // allow-fallback: localStorage unavailable in restricted environments
      // persist in-memory only
    }
    setConfigState(newConfig);
  };

  const clearConfig = () => {
    try {
      // allow-fallback: localStorage unavailable in restricted environments
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // allow-fallback: ignore
    }
    setConfigState(null);
  };

  return { config, setConfig, clearConfig, isConfigured: config !== null };
}
