import type { ICommand } from '../types.js';

export const LANGUAGE_COMMAND_DESCRIPTION = 'Set response language';
export const LANGUAGE_COMMAND_ARGUMENT_HINT = '<code>';

export const RECOMMENDED_RESPONSE_LANGUAGES = [
  { code: 'ko', description: 'Korean' },
  { code: 'en', description: 'English' },
  { code: 'ja', description: 'Japanese' },
  { code: 'zh', description: 'Chinese' },
] as const;

export type TRecommendedResponseLanguage = (typeof RECOMMENDED_RESPONSE_LANGUAGES)[number]['code'];

export function buildLanguageCommandSubcommands(source = 'language'): ICommand[] {
  return RECOMMENDED_RESPONSE_LANGUAGES.map((language) => ({
    name: language.code,
    description: language.description,
    source,
  }));
}

export function parseLanguageArgument(args: string): string | undefined {
  const language = args.trim().split(/\s+/)[0];
  return language !== undefined && language.length > 0 ? language : undefined;
}

export function formatLanguageUsageMessage(commandName = 'language'): string {
  return `Usage: ${commandName} <code> (e.g., ko, en, ja, zh)`;
}
