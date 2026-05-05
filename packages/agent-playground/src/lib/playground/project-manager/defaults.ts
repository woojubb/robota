import { getBuiltinTemplates } from '../project-manager-templates';
import type { TPlaygroundProvider } from './types';

export function getDefaultCodeForProvider(provider: TPlaygroundProvider): string {
  const templates = getBuiltinTemplates();
  const template = templates.find((candidate) => candidate.provider === provider);
  if (!template) throw new Error(`Missing built-in template for provider: ${provider}`);
  return template.code;
}

export function getDefaultModelForProvider(provider: TPlaygroundProvider): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4';
    case 'anthropic':
      return 'claude-3-opus';
    case 'google':
      return 'gemini-pro';
  }
}
