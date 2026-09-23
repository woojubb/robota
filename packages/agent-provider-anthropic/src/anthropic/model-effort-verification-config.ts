import { existsSync } from 'node:fs';

export const ANTHROPIC_MODEL_EFFORT_VERIFICATION_MODEL = 'claude-sonnet-4-6';

export interface IAnthropicModelEffortVerificationConfig {
  apiKey: string;
  model: string;
}

export function loadAnthropicModelEffortVerificationConfig(
  environment: Record<string, string | undefined>,
  environmentFilePath: string,
  environmentFileExists: (path: string) => boolean = existsSync,
  loadEnvironmentFile: (path: string) => void = process.loadEnvFile,
): IAnthropicModelEffortVerificationConfig {
  if (environmentFileExists(environmentFilePath)) loadEnvironmentFile(environmentFilePath);
  const apiKey = environment.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('ANTHROPIC_API_KEY is required');
  }
  return { apiKey, model: ANTHROPIC_MODEL_EFFORT_VERIFICATION_MODEL };
}
