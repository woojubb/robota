import { existsSync } from 'node:fs';

export const GEMINI_MODEL_EFFORT_VERIFICATION_MODEL = 'gemini-3-flash-preview';

export interface IGeminiModelEffortVerificationConfig {
  apiKey: string;
  model: string;
}

export function loadGeminiModelEffortVerificationConfig(
  environment: Record<string, string | undefined>,
  environmentFilePath: string,
  environmentFileExists: (path: string) => boolean = existsSync,
  loadEnvironmentFile: (path: string) => void = process.loadEnvFile,
): IGeminiModelEffortVerificationConfig {
  if (environmentFileExists(environmentFilePath)) loadEnvironmentFile(environmentFilePath);
  const apiKey = environment.GEMINI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('GEMINI_API_KEY is required');
  }
  return { apiKey, model: GEMINI_MODEL_EFFORT_VERIFICATION_MODEL };
}
